-- NairaPlate Step 8, part A: cash paid out of the drawer.
-- Run once in the Supabase SQL editor, BEFORE the new screens are released. Safe to re-run. Rollback: 20261028_cash_out_a_rollback.sql
-- Cash that leaves the drawer (market run, gas, supplier settlement) becomes an append-only entry on the open shift, so an honest cashier is not
-- shown as short. Cashiers may take out cash directly while their running total on the shift stays within an owner-set limit (default 10,000 naira).
-- Above it the entry is a REQUEST that an owner approves or declines. A shift cannot close while a request is waiting.
-- Purchasers and owners can mark a cash purchase or a supplier payment "paid from the cash drawer": the payout is saved in the same step, and
-- reversing the purchase or payment reverses its payout (if the shift is still open).
-- Catering: a new order function takes the deposit method (cash or transfer). The old function stays until part B.
-- Needs ledger_block_change() and block_direct_insert() (Step 6) and audit_naira().

-- 1. The owner's limit. Only a function can change it.
create table if not exists public.drawer_settings (
  business_id       text primary key references public.businesses(id) on delete cascade,
  payout_limit_kobo bigint not null default 1000000 check (payout_limit_kobo >= 0),
  updated_by        uuid,
  updated_by_name   text,
  updated_at        timestamptz not null default now()
);
alter table public.drawer_settings enable row level security;
drop policy if exists drawer_settings_select on public.drawer_settings;
create policy drawer_settings_select on public.drawer_settings for select to authenticated using (
  business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
  and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
  and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.drawer_settings from anon, authenticated;
grant select on public.drawer_settings to authenticated;
grant all on public.drawer_settings to service_role;

-- 2. The payout ledger. Entries are never edited or deleted.
--    payout   : cash left the drawer (counts). An approval is a payout row whose approves_id points at the request.
--    request  : a cashier asked to go over the limit (does not count until approved)
--    decline  : the owner declined a request (reverses_id points at it)
--    reversal : the owner cancelled a payout (reverses_id points at it, amount is negative)
create table if not exists public.cash_drawer_payouts (
  id               uuid primary key default gen_random_uuid(),
  business_id      text not null references public.businesses(id) on delete cascade,
  drawer_id        uuid not null references public.cash_drawers(id) on delete restrict,
  kind             text not null,
  amount_kobo      bigint not null,
  category         text not null,
  note             text not null,
  reverses_id      uuid references public.cash_drawer_payouts(id) on delete restrict,
  approves_id      uuid references public.cash_drawer_payouts(id) on delete restrict,
  purchase_id      uuid references public.purchases(id) on delete restrict,
  supplier_txn_id  uuid references public.supplier_transactions(id) on delete restrict,
  recorded_by      uuid,
  recorded_by_role text,
  recorded_by_name text,
  created_at       timestamptz not null default now(),
  constraint cash_drawer_payouts_kind_check check (kind in ('payout','request','decline','reversal')),
  constraint cash_drawer_payouts_category_check check (category in ('market_run','gas_fuel','transport','supplier_settlement','other','purchase','supplier_payment')),
  constraint cash_drawer_payouts_amount_rule check ((kind in ('payout','request','decline') and amount_kobo > 0) or (kind = 'reversal' and amount_kobo < 0)),
  constraint cash_drawer_payouts_note_rule check (length(btrim(note)) >= 5),
  constraint cash_drawer_payouts_link_rule check (
       (kind = 'payout'   and reverses_id is null)
    or (kind = 'request'  and reverses_id is null and approves_id is null)
    or (kind in ('decline','reversal') and reverses_id is not null and approves_id is null))
);
create index if not exists cash_drawer_payouts_drawer on public.cash_drawer_payouts (drawer_id, created_at);
-- One settling row per request or payout: an approval, a decline or a reversal, never two.
create unique index if not exists cash_drawer_payouts_one_settle on public.cash_drawer_payouts (coalesce(approves_id, reverses_id))
  where approves_id is not null or reverses_id is not null;
create unique index if not exists cash_drawer_payouts_one_per_purchase on public.cash_drawer_payouts (purchase_id) where purchase_id is not null and kind = 'payout';
create unique index if not exists cash_drawer_payouts_one_per_supplier_txn on public.cash_drawer_payouts (supplier_txn_id) where supplier_txn_id is not null and kind = 'payout';

alter table public.cash_drawer_payouts enable row level security;
drop policy if exists cash_drawer_payouts_select on public.cash_drawer_payouts;
create policy cash_drawer_payouts_select on public.cash_drawer_payouts for select to authenticated using (
  business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
  and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
  and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.cash_drawer_payouts from anon, authenticated;
grant select on public.cash_drawer_payouts to authenticated;
grant all on public.cash_drawer_payouts to service_role;

drop trigger if exists cash_drawer_payouts_no_direct_insert on public.cash_drawer_payouts;
create trigger cash_drawer_payouts_no_direct_insert before insert on public.cash_drawer_payouts
  for each row execute function public.block_direct_insert('Cash can only be taken out of the drawer from the Cash drawer screen.');
drop trigger if exists cash_drawer_payouts_no_change on public.cash_drawer_payouts;
create trigger cash_drawer_payouts_no_change before update or delete on public.cash_drawer_payouts
  for each row execute function public.ledger_block_change();

-- 3. A closed shift keeps what was paid out, with the rest of its breakdown.
alter table public.cash_drawers add column if not exists payouts_kobo bigint;

-- 4. A shift cannot close while a request is waiting (every close, including an owner closing a shift someone left open).
create or replace function public.cash_drawers_pending_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if OLD.status = 'open' and NEW.status = 'closed' and exists (
       select 1 from public.cash_drawer_payouts r
        where r.drawer_id = OLD.id and r.kind = 'request'
          and not exists (select 1 from public.cash_drawer_payouts s where coalesce(s.approves_id, s.reverses_id) = r.id)) then
    raise exception 'A cash payout is waiting for the owner. Approve or decline it before closing the shift.';
  end if;
  return NEW;
end $function$;
drop trigger if exists cash_drawers_pending_guard on public.cash_drawers;
create trigger cash_drawers_pending_guard before update on public.cash_drawers
  for each row execute function public.cash_drawers_pending_guard();

-- 5. The owner's limit.
create or replace function public.set_drawer_payout_limit(p_limit_kobo bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role'; v_name text; v_old bigint;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can set the payout limit.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_limit_kobo is null or p_limit_kobo < 0 then raise exception 'The limit cannot be negative.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  select payout_limit_kobo into v_old from public.drawer_settings where business_id = v_biz;
  insert into public.drawer_settings (business_id, payout_limit_kobo, updated_by, updated_by_name, updated_at)
  values (v_biz, p_limit_kobo, auth.uid(), coalesce(v_name, 'Owner'), now())
  on conflict (business_id) do update set payout_limit_kobo = excluded.payout_limit_kobo, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now();
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'drawer_limit_changed', 'drawer_settings', null,
          format('%s changed the cash payout limit from %s to %s', coalesce(v_name, 'Owner'), public.audit_naira(coalesce(v_old, 1000000)), public.audit_naira(p_limit_kobo)));
  return jsonb_build_object('payout_limit_kobo', p_limit_kobo);
end $function$;

-- 6. Take cash out of the open shift (direct, or a request when a cashier is over the limit).
create or replace function public.record_cash_payout(p_amount_kobo bigint, p_category text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.cash_drawers%rowtype; v_limit bigint; v_direct bigint; v_id uuid; v_kind text := 'payout'; v_label text;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take cash out of the drawer.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'The amount must be more than zero.'; end if;
  if p_category is null or p_category not in ('market_run','gas_fuel','transport','supplier_settlement','other') then raise exception 'Choose what the cash was for.'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say what it was for (at least 5 characters).'; end if;
  select * into d from public.cash_drawers where business_id = v_biz and status = 'open' for update;
  if not found then raise exception 'There is no open shift. Open a shift first.'; end if;
  if v_role = 'cashier' and d.opened_by is distinct from auth.uid() then raise exception 'Only the cashier who opened this shift can take cash out of it.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  select coalesce((select payout_limit_kobo from public.drawer_settings where business_id = v_biz), 1000000) into v_limit;
  v_label := case p_category when 'market_run' then 'market run' when 'gas_fuel' then 'gas or fuel' when 'transport' then 'transport' when 'supplier_settlement' then 'supplier settlement' else 'other' end;
  if v_role = 'cashier' then
    select coalesce(sum(p.amount_kobo), 0) into v_direct from public.cash_drawer_payouts p
     where p.drawer_id = d.id and p.kind = 'payout' and p.approves_id is null and p.recorded_by_role = 'cashier'
       and p.category not in ('purchase','supplier_payment')
       and not exists (select 1 from public.cash_drawer_payouts z where z.reverses_id = p.id and z.kind = 'reversal');
    if v_direct + p_amount_kobo > v_limit then v_kind := 'request'; end if;
  end if;
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, d.id, v_kind, p_amount_kobo, p_category, btrim(p_note), auth.uid(), v_role, coalesce(v_name, 'Staff'))
  returning id into v_id;
  if v_kind = 'request' then
    insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
    values (v_biz, 'payout_request', 'warn',
            format('%s asked to take %s out of the drawer (%s): %s. Open Cash drawer to approve or decline.', coalesce(v_name, 'A cashier'), public.audit_naira(p_amount_kobo), v_label, btrim(p_note)), 'owner', false);
    insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
    values (v_biz, auth.uid(), v_role, 'cash_payout_requested', 'cash_drawer_payouts', v_id,
            format('%s asked to take %s out of the drawer (%s): %s', coalesce(v_name, 'A cashier'), public.audit_naira(p_amount_kobo), v_label, btrim(p_note)));
    return jsonb_build_object('status', 'requested', 'id', v_id, 'limit_kobo', v_limit);
  end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_recorded', 'cash_drawer_payouts', v_id,
          format('%s took %s out of the drawer (%s): %s', coalesce(v_name, 'Staff'), public.audit_naira(p_amount_kobo), v_label, btrim(p_note)));
  return jsonb_build_object('status', 'recorded', 'id', v_id, 'limit_kobo', v_limit);
end $function$;

-- 7. Owner approves a waiting request: the approval is a payout row that points at it.
create or replace function public.approve_cash_payout(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; r public.cash_drawer_payouts%rowtype; v_status text; v_id uuid;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can approve a cash payout.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  select * into r from public.cash_drawer_payouts where id = p_request_id and business_id = v_biz for update;
  if not found or r.kind <> 'request' then raise exception 'Request not found.'; end if;
  if exists (select 1 from public.cash_drawer_payouts s where coalesce(s.approves_id, s.reverses_id) = r.id) then raise exception 'This request has already been decided.'; end if;
  select status into v_status from public.cash_drawers where id = r.drawer_id;
  if v_status is distinct from 'open' then raise exception 'That shift is closed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, approves_id, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, r.drawer_id, 'payout', r.amount_kobo, r.category, r.note, r.id, auth.uid(), v_role, coalesce(v_name, 'Owner'))
  returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_approved', 'cash_drawer_payouts', v_id,
          format('%s approved %s asking to take %s out of the drawer: %s', coalesce(v_name, 'Owner'), coalesce(r.recorded_by_name, 'a cashier'), public.audit_naira(r.amount_kobo), r.note));
  return jsonb_build_object('payout_id', v_id);
end $function$;

-- 8. Owner declines a waiting request (reason of 5+ characters). Nothing is deducted.
create or replace function public.decline_cash_payout(p_request_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; r public.cash_drawer_payouts%rowtype; v_id uuid;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can decline a cash payout.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into r from public.cash_drawer_payouts where id = p_request_id and business_id = v_biz for update;
  if not found or r.kind <> 'request' then raise exception 'Request not found.'; end if;
  if exists (select 1 from public.cash_drawer_payouts s where coalesce(s.approves_id, s.reverses_id) = r.id) then raise exception 'This request has already been decided.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, reverses_id, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, r.drawer_id, 'decline', r.amount_kobo, r.category, btrim(p_reason), r.id, auth.uid(), v_role, coalesce(v_name, 'Owner'))
  returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_declined', 'cash_drawer_payouts', v_id,
          format('%s declined %s asking to take %s out of the drawer: %s', coalesce(v_name, 'Owner'), coalesce(r.recorded_by_name, 'a cashier'), public.audit_naira(r.amount_kobo), btrim(p_reason)));
  return jsonb_build_object('decline_id', v_id);
end $function$;

-- 9. Owner reverses a payout while its shift is open (a closed shift is corrected with "Correct the count").
create or replace function public.reverse_cash_payout(p_payout_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; p public.cash_drawer_payouts%rowtype; v_status text; v_id uuid;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a cash payout.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into p from public.cash_drawer_payouts where id = p_payout_id and business_id = v_biz for update;
  if not found or p.kind <> 'payout' then raise exception 'Payout not found.'; end if;
  if exists (select 1 from public.cash_drawer_payouts s where s.reverses_id = p.id) then raise exception 'This payout has already been reversed.'; end if;
  select status into v_status from public.cash_drawers where id = p.drawer_id;
  if v_status is distinct from 'open' then raise exception 'That shift is closed. Use Correct the count on the closed shift instead.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, reverses_id, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, p.drawer_id, 'reversal', -p.amount_kobo, p.category, btrim(p_reason), p.id, auth.uid(), v_role, coalesce(v_name, 'Owner'))
  returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_reversed', 'cash_drawer_payouts', v_id,
          format('%s reversed a cash payout of %s: %s', coalesce(v_name, 'Owner'), public.audit_naira(p.amount_kobo), btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id);
end $function$;

-- 10. A cash purchase "paid from the cash drawer": the purchase and its payout are saved together or not at all.
create or replace function public.log_purchase_from_drawer(
  p_ingredient_id uuid, p_qty numeric, p_market_unit text, p_total_kobo bigint, p_payment_method text,
  p_grade text, p_season text, p_raw_transcript text, p_supplier_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.cash_drawers%rowtype; v_res jsonb; v_pid uuid; v_ing text;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('purchaser','owner','supa_admin') then raise exception 'Only purchasers and owners can log a purchase.'; end if;
  if p_payment_method is distinct from 'cash' then raise exception 'Only a cash purchase can be paid from the cash drawer.'; end if;
  select * into d from public.cash_drawers where business_id = v_biz and status = 'open' for update;
  if not found then raise exception 'There is no open shift, so this cannot be paid from the cash drawer. Open a shift first, or save the purchase without the box ticked.'; end if;
  v_res := public.log_purchase(p_ingredient_id, p_qty, p_market_unit, p_total_kobo, p_payment_method, p_grade, p_season, p_raw_transcript, p_supplier_id);
  v_pid := (v_res ->> 'purchase_id')::uuid;
  select display_name into v_name from public.staff_users where id = auth.uid();
  select name into v_ing from public.ingredients where id = p_ingredient_id;
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, purchase_id, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, d.id, 'payout', p_total_kobo, 'purchase', 'Purchase of ' || coalesce(v_ing, 'an ingredient') || ', paid from the drawer', v_pid, auth.uid(), v_role, coalesce(v_name, 'Staff'));
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_recorded', 'purchases', v_pid,
          format('%s paid %s from the drawer for a purchase of %s', coalesce(v_name, 'Staff'), public.audit_naira(p_total_kobo), coalesce(v_ing, 'an ingredient')));
  return v_res || jsonb_build_object('paid_from_drawer', true);
end $function$;

-- 11. A supplier payment "paid from the cash drawer".
create or replace function public.record_supplier_payment_from_drawer(p_supplier_id uuid, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.cash_drawers%rowtype; v_res jsonb; v_tid uuid; v_sup text;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('purchaser','owner','supa_admin') then raise exception 'Only purchasers and owners can record a supplier payment.'; end if;
  select * into d from public.cash_drawers where business_id = v_biz and status = 'open' for update;
  if not found then raise exception 'There is no open shift, so this cannot be paid from the cash drawer. Open a shift first, or save the payment without the box ticked.'; end if;
  v_res := public.record_supplier_payment(p_supplier_id, p_amount_kobo, p_note);
  v_tid := (v_res ->> 'id')::uuid;
  select display_name into v_name from public.staff_users where id = auth.uid();
  select name into v_sup from public.suppliers where id = p_supplier_id;
  insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, supplier_txn_id, recorded_by, recorded_by_role, recorded_by_name)
  values (v_biz, d.id, 'payout', p_amount_kobo, 'supplier_payment', 'Payment to ' || coalesce(v_sup, 'a supplier') || ', paid from the drawer', v_tid, auth.uid(), v_role, coalesce(v_name, 'Staff'));
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'cash_payout_recorded', 'supplier_transactions', v_tid,
          format('%s paid %s from the drawer to %s', coalesce(v_name, 'Staff'), public.audit_naira(p_amount_kobo), coalesce(v_sup, 'a supplier')));
  return v_res || jsonb_build_object('paid_from_drawer', true);
end $function$;

-- 12. Reversing the purchase or the payment reverses its payout, in the same step, if the shift is still open.
create or replace function public.cash_payout_follow_reversal()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  pay public.cash_drawer_payouts%rowtype; v_status text; v_role text := auth.jwt() -> 'app_metadata' ->> 'role'; v_id uuid; v_reason text; v_name text;
begin
  if TG_TABLE_NAME = 'purchases' then
    select * into pay from public.cash_drawer_payouts p where p.purchase_id = NEW.reverses_id and p.kind = 'payout'
       and not exists (select 1 from public.cash_drawer_payouts z where z.reverses_id = p.id and z.kind = 'reversal') limit 1;
    v_reason := NEW.reason; v_name := NEW.recorded_by_name;
  else
    select * into pay from public.cash_drawer_payouts p where p.supplier_txn_id = NEW.reverses_id and p.kind = 'payout'
       and not exists (select 1 from public.cash_drawer_payouts z where z.reverses_id = p.id and z.kind = 'reversal') limit 1;
    v_reason := NEW.reason; v_name := NEW.recorded_by_name;
  end if;
  if not found then return NEW; end if;
  select status into v_status from public.cash_drawers where id = pay.drawer_id;
  if v_status = 'open' then
    insert into public.cash_drawer_payouts (business_id, drawer_id, kind, amount_kobo, category, note, reverses_id, recorded_by, recorded_by_role, recorded_by_name)
    values (pay.business_id, pay.drawer_id, 'reversal', -pay.amount_kobo, pay.category, btrim(coalesce(v_reason, 'reversed with the original')), pay.id, auth.uid(), coalesce(v_role, 'owner'), coalesce(v_name, 'Owner'))
    returning id into v_id;
    insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
    values (pay.business_id, auth.uid(), v_role, 'cash_payout_reversed', 'cash_drawer_payouts', v_id,
            format('Cash payout of %s reversed together with its %s: %s', public.audit_naira(pay.amount_kobo), case when TG_TABLE_NAME = 'purchases' then 'purchase' else 'supplier payment' end, btrim(coalesce(v_reason, ''))));
  else
    insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
    values (pay.business_id, auth.uid(), v_role, 'cash_payout_left_on_closed_shift', 'cash_drawer_payouts', pay.id,
            format('A %s paid from the drawer (%s) was reversed after its shift closed. The shift figure is unchanged; use Correct the count if needed.', case when TG_TABLE_NAME = 'purchases' then 'purchase' else 'supplier payment' end, public.audit_naira(pay.amount_kobo)));
  end if;
  return NEW;
end $function$;
drop trigger if exists purchases_cash_payout_follow on public.purchases;
create trigger purchases_cash_payout_follow after insert on public.purchases
  for each row when (NEW.kind = 'reversal') execute function public.cash_payout_follow_reversal();
drop trigger if exists supplier_transactions_cash_payout_follow on public.supplier_transactions;
create trigger supplier_transactions_cash_payout_follow after insert on public.supplier_transactions
  for each row when (NEW.type = 'reversal') execute function public.cash_payout_follow_reversal();

-- 13. Catering: a new order function that records how the deposit was paid. (The old function, without a method, stays until part B.)
--     The method has no default, so a call without it can only match the old function.
create or replace function public.create_catering_order(
  p_customer text, p_phone text, p_event_date date, p_event_time time without time zone, p_address text, p_notes text, p_items jsonb,
  p_delivery_fee_kobo bigint, p_discount_kobo bigint, p_deposit_kobo bigint, p_deposit_method text, p_status text default 'confirmed')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; v_today date := (now() at time zone 'Africa/Lagos')::date;
  it jsonb; v_qty numeric; v_price bigint; v_dish text; v_rid uuid; v_sub bigint := 0; v_total bigint; v_line bigint;
  v_id uuid; v_summary text := ''; v_fee bigint := coalesce(p_delivery_fee_kobo, 0); v_disc bigint := coalesce(p_discount_kobo, 0); v_dep bigint := coalesce(p_deposit_kobo, 0);
  v_lines jsonb := '[]'::jsonb;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take catering orders.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if not public.catering_enabled(v_biz) then raise exception 'Catering orders are not switched on for this business.'; end if;
  if length(btrim(coalesce(p_customer, ''))) < 1 then raise exception 'Enter the customer name.'; end if;
  if p_event_date is null or p_event_time is null then raise exception 'Enter the event date and time.'; end if;
  if p_event_date < v_today then raise exception 'That date has already passed.'; end if;
  if p_status not in ('enquiry','confirmed') then raise exception 'A new order is an enquiry or confirmed.'; end if;
  if v_fee < 0 or v_disc < 0 or v_dep < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if v_dep > 0 and coalesce(p_deposit_method, '') not in ('cash','transfer') then raise exception 'Choose how the deposit was paid: cash or transfer.'; end if;
  if v_disc > 0 and v_role not in ('owner','supa_admin') then raise exception 'Only an owner can give a discount.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Every item needs a quantity above zero.'; end if;
    if nullif(it->>'recipe_id', '') is not null then
      v_rid := (it->>'recipe_id')::uuid;
      select name, selling_price_kobo into v_dish, v_price from public.recipes where id = v_rid and business_id = v_biz and is_current;
      if not found then raise exception 'A dish in this order was not found on your menu.'; end if;
      v_lines := v_lines || jsonb_build_object('recipe_id', v_rid, 'name', v_dish, 'qty', v_qty, 'price', v_price, 'custom', false);
    else
      if v_role not in ('owner','supa_admin') then raise exception 'Only an owner can add an item that is not on the menu.'; end if;
      v_dish := btrim(coalesce(it->>'name', ''));
      v_price := (it->>'unit_price_kobo')::bigint;
      if v_dish = '' or v_price is null or v_price < 0 then raise exception 'A custom item needs a name and a price.'; end if;
      v_lines := v_lines || jsonb_build_object('recipe_id', null, 'name', v_dish, 'qty', v_qty, 'price', v_price, 'custom', true);
    end if;
    v_sub := v_sub + round(v_price * v_qty);
  end loop;

  if v_disc > v_sub then raise exception 'The discount cannot be more than the items total.'; end if;
  v_total := v_sub + v_fee - v_disc;
  if v_total <= 0 then raise exception 'The order total must be more than zero.'; end if;
  if v_dep > v_total then raise exception 'The deposit cannot be more than the order total.'; end if;

  for it in select * from jsonb_array_elements(v_lines) loop
    v_summary := v_summary || case when v_summary = '' then '' else ', ' end
              || case when (it->>'qty')::numeric = trunc((it->>'qty')::numeric) then trunc((it->>'qty')::numeric)::text else (it->>'qty') end || ' x ' || (it->>'name');
  end loop;

  insert into public.catering_deposits (business_id, customer_name, phone, event_date, event_time, total_contract_kobo, deposit_kobo, items_summary, settled,
                                        status, delivery_address, notes, delivery_fee_kobo, discount_kobo, subtotal_kobo)
  values (v_biz, btrim(p_customer), nullif(btrim(coalesce(p_phone, '')), ''), p_event_date, p_event_time, v_total, 0, v_summary, false,
          p_status, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), v_fee, v_disc, v_sub)
  returning id into v_id;

  insert into public.catering_order_items (business_id, order_id, recipe_id, recipe_name, quantity, unit_price_kobo, line_total_kobo, is_custom)
  select v_biz, v_id, nullif(l->>'recipe_id', '')::uuid, l->>'name', (l->>'qty')::numeric, (l->>'price')::bigint, round((l->>'price')::bigint * (l->>'qty')::numeric), (l->>'custom')::boolean
    from jsonb_array_elements(v_lines) l;

  select display_name into v_name from public.staff_users where id = auth.uid();
  if v_dep > 0 then
    insert into public.catering_payments (business_id, order_id, kind, amount_kobo, method, recorded_by, recorded_by_name)
    values (v_biz, v_id, 'deposit', v_dep, p_deposit_method, auth.uid(), coalesce(v_name, 'Staff'));
  end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_order_created', 'catering_deposits', v_id,
          format('%s took a catering order for %s on %s: %s kobo, deposit %s kobo%s', coalesce(v_name, 'Staff'), btrim(p_customer), p_event_date, v_total, v_dep,
                 case when v_dep > 0 then ' (' || p_deposit_method || ')' else '' end));
  return jsonb_build_object('id', v_id, 'subtotal_kobo', v_sub, 'total_kobo', v_total, 'deposit_kobo', v_dep, 'balance_kobo', v_total - v_dep, 'summary', v_summary);
end $function$;

-- 14. Only signed-in people can call the callable functions (each checks role, business and plan inside). Nobody can run the trigger functions.
revoke all on function public.set_drawer_payout_limit(bigint) from public, anon;
revoke all on function public.record_cash_payout(bigint, text, text) from public, anon;
revoke all on function public.approve_cash_payout(uuid) from public, anon;
revoke all on function public.decline_cash_payout(uuid, text) from public, anon;
revoke all on function public.reverse_cash_payout(uuid, text) from public, anon;
revoke all on function public.log_purchase_from_drawer(uuid, numeric, text, bigint, text, text, text, text, uuid) from public, anon;
revoke all on function public.record_supplier_payment_from_drawer(uuid, bigint, text) from public, anon;
revoke all on function public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text, text) from public, anon;
grant execute on function public.set_drawer_payout_limit(bigint) to authenticated;
grant execute on function public.record_cash_payout(bigint, text, text) to authenticated;
grant execute on function public.approve_cash_payout(uuid) to authenticated;
grant execute on function public.decline_cash_payout(uuid, text) to authenticated;
grant execute on function public.reverse_cash_payout(uuid, text) to authenticated;
grant execute on function public.log_purchase_from_drawer(uuid, numeric, text, bigint, text, text, text, text, uuid) to authenticated;
grant execute on function public.record_supplier_payment_from_drawer(uuid, bigint, text) to authenticated;
grant execute on function public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text, text) to authenticated;
revoke all on function public.cash_drawers_pending_guard() from public, anon, authenticated;
revoke all on function public.cash_payout_follow_reversal() from public, anon, authenticated;
