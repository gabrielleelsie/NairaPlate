-- NairaPlate append-only records, step 3, part A: customer credit payments, write-offs and reversals.
-- Run once in the Supabase SQL editor, BEFORE the new credit screen is released. Safe to re-run. Rollback: 20261021_credit_ledger_a_rollback.sql
-- Every payment, write-off and correction on a debt becomes its own entry. Entries are never edited or deleted. A mistake is corrected by a
-- reversal entry (owner only, with a reason). The cached totals on the debt (paid, written off, settled) are worked out from the entries.
-- The size of a debt can no longer be changed by anyone signed in. Needs ledger_block_change() from 20261019_catering_payments.sql.
-- Until part B, the old "Mark settled" button still flips the flag, so release the new screen soon after running this.

-- 1. Totals on each debt, and a note for debts created by hand.
alter table public.customer_credits
  add column if not exists paid_kobo bigint not null default 0,
  add column if not exists written_off_kobo bigint not null default 0,
  add column if not exists note text;

-- 2. The entries.
create table if not exists public.credit_payments (
  id               uuid        primary key default gen_random_uuid(),
  business_id      text        not null references public.businesses(id) on delete cascade,
  credit_id        uuid        not null references public.customer_credits(id) on delete cascade,
  kind             text        not null check (kind in ('payment','write_off','reversal')),
  amount_kobo      bigint      not null,
  method           text        check (method is null or method in ('cash','transfer')),
  reverses_id      uuid        references public.credit_payments(id),
  reason           text,
  carried_over     boolean     not null default false,
  recorded_by      uuid,
  recorded_by_name text,
  created_at       timestamptz not null default now(),
  constraint credit_payments_amount_rule check ((kind in ('payment','write_off') and amount_kobo > 0) or (kind = 'reversal' and amount_kobo < 0)),
  constraint credit_payments_reversal_rule check ((kind = 'reversal') = (reverses_id is not null)),
  constraint credit_payments_reason_rule check (kind = 'payment' or length(btrim(coalesce(reason, ''))) >= 5 or carried_over)
);
create unique index if not exists credit_payments_one_reversal on public.credit_payments (reverses_id) where reverses_id is not null;
create index if not exists credit_payments_credit_idx on public.credit_payments (credit_id, created_at);

alter table public.credit_payments enable row level security;
drop policy if exists credit_payments_select on public.credit_payments;
create policy credit_payments_select on public.credit_payments for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.credit_payments from anon, authenticated;
grant select on public.credit_payments to authenticated;
grant all on public.credit_payments to service_role;

drop trigger if exists credit_payments_no_change on public.credit_payments;
create trigger credit_payments_no_change before update or delete on public.credit_payments
  for each row execute function public.ledger_block_change();

-- 3. Rules on every new entry, whoever writes it: a payment or write-off cannot be more than is owed; a reversal undoes exactly one
--    payment or write-off of the same debt, for the same amount, once, and only an owner may write one. One change at a time per debt.
create or replace function public.credit_payments_check()
returns trigger language plpgsql set search_path to 'public' as $function$
declare c public.customer_credits%rowtype; o public.credit_payments%rowtype;
begin
  if current_setting('app.ledger_backfill', true) = '1' then return NEW; end if;
  select * into c from public.customer_credits where id = NEW.credit_id for update;
  if not found or c.business_id <> NEW.business_id then raise exception 'Debt not found.'; end if;
  if NEW.kind in ('payment','write_off') then
    if NEW.amount_kobo > c.amount_kobo - c.paid_kobo - c.written_off_kobo then raise exception 'That is more than the customer owes.'; end if;
    if NEW.kind = 'write_off' and auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
      raise exception 'Only an owner can write off a debt.';
    end if;
    return NEW;
  end if;
  if auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
    raise exception 'Only an owner can reverse an entry.';
  end if;
  select * into o from public.credit_payments where id = NEW.reverses_id;
  if not found then raise exception 'The entry being reversed was not found.'; end if;
  if o.kind not in ('payment','write_off') then raise exception 'Only a payment or a write-off can be reversed.'; end if;
  if o.credit_id <> NEW.credit_id or o.business_id <> NEW.business_id then raise exception 'That entry belongs to a different debt.'; end if;
  if NEW.amount_kobo <> -o.amount_kobo then raise exception 'A reversal must be for exactly the amount of the entry.'; end if;
  return NEW;
end $function$;
drop trigger if exists credit_payments_check on public.credit_payments;
create trigger credit_payments_check before insert on public.credit_payments
  for each row execute function public.credit_payments_check();

-- 4. The totals on the debt come from the entries. A debt is settled when nothing is left to pay.
create or replace function public.credit_payments_recompute()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_paid bigint; v_off bigint;
begin
  if current_setting('app.ledger_backfill', true) = '1' then return NEW; end if;
  perform set_config('app.credit_internal', '1', true);
  select coalesce(sum(p.amount_kobo) filter (where p.kind = 'payment' or (p.kind = 'reversal' and o.kind = 'payment')), 0),
         coalesce(sum(p.amount_kobo) filter (where p.kind = 'write_off' or (p.kind = 'reversal' and o.kind = 'write_off')), 0)
    into v_paid, v_off
    from public.credit_payments p left join public.credit_payments o on o.id = p.reverses_id
   where p.credit_id = NEW.credit_id;
  update public.customer_credits set paid_kobo = v_paid, written_off_kobo = v_off, settled = (amount_kobo - v_paid - v_off) <= 0 where id = NEW.credit_id;
  perform set_config('app.credit_internal', '', true);
  return NEW;
end $function$;
drop trigger if exists credit_payments_recompute on public.credit_payments;
create trigger credit_payments_recompute after insert on public.credit_payments
  for each row execute function public.credit_payments_recompute();

-- 5. The size of a debt can never be changed from the browser, nor which sale or business it belongs to.
create or replace function public.customer_credits_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then return NEW; end if;
  if NEW.amount_kobo is distinct from OLD.amount_kobo or NEW.order_id is distinct from OLD.order_id or NEW.business_id is distinct from OLD.business_id then
    raise exception 'The amount of a debt cannot be changed. Record a payment, a write-off or a correction instead.';
  end if;
  return NEW;
end $function$;
drop trigger if exists customer_credits_protect on public.customer_credits;
create trigger customer_credits_protect before update on public.customer_credits
  for each row execute function public.customer_credits_protect();

-- 6. Carry over what exists today. A debt already marked settled gets one "carried over" payment for its full amount (it is not known
--    whether money was received). Nothing else changes.
do $$ declare c record; begin
  perform set_config('app.ledger_backfill', '1', true);
  for c in select * from public.customer_credits k where k.settled and not exists (select 1 from public.credit_payments p where p.credit_id = k.id) loop
    insert into public.credit_payments (business_id, credit_id, kind, amount_kobo, carried_over, recorded_by_name, created_at, reason)
    values (c.business_id, c.id, 'payment', c.amount_kobo, true, 'Carried over', c.created_at, 'Marked settled before payments were recorded');
    update public.customer_credits set paid_kobo = c.amount_kobo where id = c.id;
  end loop;
  perform set_config('app.ledger_backfill', '', true);
end $$;

-- 7. Recording a payment (part-payments allowed, never more than is owed).
create or replace function public.record_credit_payment(p_credit_id uuid, p_amount_kobo bigint, p_method text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; c public.customer_credits%rowtype; v_id uuid; v_left bigint;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can record payments.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if p_method is null or p_method not in ('cash','transfer') then raise exception 'Choose cash or transfer.'; end if;
  select * into c from public.customer_credits where id = p_credit_id and business_id = v_biz for update;
  if not found then raise exception 'Debt not found.'; end if;
  v_left := c.amount_kobo - c.paid_kobo - c.written_off_kobo;
  if v_left <= 0 then raise exception 'Nothing is owed on this debt.'; end if;
  if p_amount_kobo > v_left then raise exception 'That is more than the customer owes (₦%).', to_char(v_left / 100.0, 'FM999,999,990.00'); end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.credit_payments (business_id, credit_id, kind, amount_kobo, method, recorded_by, recorded_by_name)
  values (v_biz, c.id, 'payment', p_amount_kobo, p_method, auth.uid(), coalesce(v_name, 'Staff')) returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'credit_payment_recorded', 'customer_credits', c.id,
          format('%s took a %s payment of %s kobo from %s (left to pay %s)', coalesce(v_name, 'Staff'), p_method, p_amount_kobo, c.customer_name, v_left - p_amount_kobo));
  select * into c from public.customer_credits where id = c.id;
  return jsonb_build_object('id', v_id, 'paid_kobo', c.paid_kobo, 'balance_kobo', c.amount_kobo - c.paid_kobo - c.written_off_kobo, 'settled', c.settled);
end $function$;
revoke all on function public.record_credit_payment(uuid, bigint, text) from public, anon;
grant execute on function public.record_credit_payment(uuid, bigint, text) to authenticated, service_role;

-- 8. Writing off a debt: owner only, a reason of 5 or more characters, the whole balance (amount left empty) or part of it.
create or replace function public.write_off_credit(p_credit_id uuid, p_amount_kobo bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; c public.customer_credits%rowtype; v_id uuid; v_left bigint; v_amt bigint;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can write off a debt.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into c from public.customer_credits where id = p_credit_id and business_id = v_biz for update;
  if not found then raise exception 'Debt not found.'; end if;
  v_left := c.amount_kobo - c.paid_kobo - c.written_off_kobo;
  if v_left <= 0 then raise exception 'Nothing is owed on this debt.'; end if;
  v_amt := coalesce(p_amount_kobo, v_left);
  if v_amt <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if v_amt > v_left then raise exception 'That is more than the customer owes (₦%).', to_char(v_left / 100.0, 'FM999,999,990.00'); end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.credit_payments (business_id, credit_id, kind, amount_kobo, reason, recorded_by, recorded_by_name)
  values (v_biz, c.id, 'write_off', v_amt, btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner')) returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'credit_written_off', 'customer_credits', c.id,
          format('%s wrote off %s kobo owed by %s: %s', coalesce(v_name, 'Owner'), v_amt, c.customer_name, btrim(p_reason)));
  select * into c from public.customer_credits where id = c.id;
  return jsonb_build_object('id', v_id, 'written_off_kobo', c.written_off_kobo, 'balance_kobo', c.amount_kobo - c.paid_kobo - c.written_off_kobo, 'settled', c.settled);
end $function$;
revoke all on function public.write_off_credit(uuid, bigint, text) from public, anon;
grant execute on function public.write_off_credit(uuid, bigint, text) to authenticated, service_role;

-- 9. Reversing a payment or a write-off: owner only, with a reason. The original stays; a minus entry is added beside it.
create or replace function public.reverse_credit_entry(p_entry_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; e public.credit_payments%rowtype; c public.customer_credits%rowtype; v_id uuid;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse an entry.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into e from public.credit_payments where id = p_entry_id and business_id = v_biz;
  if not found then raise exception 'Entry not found.'; end if;
  if e.kind not in ('payment','write_off') then raise exception 'Only a payment or a write-off can be reversed.'; end if;
  select * into c from public.customer_credits where id = e.credit_id for update;
  if exists (select 1 from public.credit_payments where reverses_id = e.id) then raise exception 'This entry has already been reversed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.credit_payments (business_id, credit_id, kind, amount_kobo, method, reverses_id, reason, recorded_by, recorded_by_name)
  values (v_biz, e.credit_id, 'reversal', -e.amount_kobo, e.method, e.id, btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner')) returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'credit_entry_reversed', 'customer_credits', e.credit_id,
          format('%s reversed a %s of %s kobo for %s: %s', coalesce(v_name, 'Owner'), replace(e.kind, '_', ' '), e.amount_kobo, c.customer_name, btrim(p_reason)));
  select * into c from public.customer_credits where id = e.credit_id;
  return jsonb_build_object('reversal_id', v_id, 'balance_kobo', c.amount_kobo - c.paid_kobo - c.written_off_kobo, 'settled', c.settled);
end $function$;
revoke all on function public.reverse_credit_entry(uuid, text) from public, anon;
grant execute on function public.reverse_credit_entry(uuid, text) to authenticated, service_role;

-- 10. A debt that is not from a till sale: owner only. Cashiers make debts through the Till.
create or replace function public.create_manual_credit(p_customer text, p_phone text, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; v_id uuid;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can add a debt by hand. Cashiers add credit on the Till.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_customer, ''))) < 1 then raise exception 'Enter the customer name.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  insert into public.customer_credits (business_id, customer_name, phone, amount_kobo, settled, note)
  values (v_biz, btrim(p_customer), nullif(btrim(coalesce(p_phone, '')), ''), p_amount_kobo, false, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_id;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'credit_created_manual', 'customer_credits', v_id,
          format('%s added a debt of %s kobo owed by %s', coalesce(v_name, 'Owner'), p_amount_kobo, btrim(p_customer)));
  return jsonb_build_object('id', v_id);
end $function$;
revoke all on function public.create_manual_credit(text, text, bigint, text) from public, anon;
grant execute on function public.create_manual_credit(text, text, bigint, text) to authenticated, service_role;
