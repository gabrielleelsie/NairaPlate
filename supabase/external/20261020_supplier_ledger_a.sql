-- NairaPlate append-only records, step 2, part A: supplier payments and reversals.
-- Run once in the Supabase SQL editor, BEFORE the new supplier screens are released. Safe to re-run. Rollback: 20261020_supplier_ledger_a_rollback.sql
-- Supplier entries can no longer be edited or deleted by a signed-in person. A payment made by mistake is undone by a reversal entry
-- (owner only, with a reason). Credit purchases still arrive through log_purchase. The old Pay a supplier screen keeps working until part B.
-- Needs ledger_block_change() from 20261019_catering_payments.sql.

-- 1. More about each entry, and a third entry type.
alter table public.supplier_transactions
  add column if not exists reverses_id uuid references public.supplier_transactions(id),
  add column if not exists reason text,
  add column if not exists recorded_by_name text;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_type_check;
alter table public.supplier_transactions add constraint supplier_transactions_type_check check (type in ('purchase_on_credit','payment','reversal'));
-- New entries must be above zero (entries from before are not re-checked).
alter table public.supplier_transactions drop constraint if exists supplier_transactions_amount_positive;
alter table public.supplier_transactions add constraint supplier_transactions_amount_positive check (amount_kobo > 0) not valid;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_reversal_rule;
alter table public.supplier_transactions add constraint supplier_transactions_reversal_rule check ((type = 'reversal') = (reverses_id is not null)) not valid;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_reason_rule;
alter table public.supplier_transactions add constraint supplier_transactions_reason_rule check (type <> 'reversal' or length(btrim(coalesce(reason, ''))) >= 5) not valid;
create unique index if not exists supplier_transactions_one_reversal on public.supplier_transactions (reverses_id) where reverses_id is not null;

-- 2. Frozen: no signed-in person can change or delete an entry (the server and the SQL editor can, for admin work only).
drop trigger if exists supplier_transactions_no_change on public.supplier_transactions;
create trigger supplier_transactions_no_change before update or delete on public.supplier_transactions
  for each row execute function public.ledger_block_change();

-- 3. A reversal undoes exactly one payment of the same supplier, for the same amount, once, and only an owner may write one.
create or replace function public.supplier_transactions_check_reversal()
returns trigger language plpgsql set search_path to 'public' as $function$
declare o public.supplier_transactions%rowtype;
begin
  if NEW.type <> 'reversal' then return NEW; end if;
  if auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
    raise exception 'Only an owner can reverse a payment.';
  end if;
  select * into o from public.supplier_transactions where id = NEW.reverses_id;
  if not found then raise exception 'The payment being reversed was not found.'; end if;
  if o.type <> 'payment' then raise exception 'Only a payment can be reversed.'; end if;
  if o.supplier_id <> NEW.supplier_id or o.business_id <> NEW.business_id then raise exception 'That payment belongs to a different supplier.'; end if;
  if NEW.amount_kobo <> o.amount_kobo then raise exception 'A reversal must be for exactly the amount of the payment.'; end if;
  return NEW;
end $function$;
drop trigger if exists supplier_transactions_check_reversal on public.supplier_transactions;
create trigger supplier_transactions_check_reversal before insert on public.supplier_transactions
  for each row execute function public.supplier_transactions_check_reversal();

-- 4. What is owed to a supplier now. Internal helper (credit purchases + reversed payments - payments). A negative number means the supplier owes you.
create or replace function public.supplier_balance_kobo(p_business_id text, p_supplier_id uuid)
returns bigint language sql stable security definer set search_path to 'public' as $function$
  select coalesce(sum(case type when 'purchase_on_credit' then amount_kobo when 'payment' then -amount_kobo when 'reversal' then amount_kobo else 0 end), 0)::bigint
    from public.supplier_transactions where business_id = p_business_id and supplier_id = p_supplier_id
$function$;
revoke all on function public.supplier_balance_kobo(text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_balance_kobo(text, uuid) to service_role;

-- 5. Recording a payment. Paying more than is owed is allowed (an advance); the screen asks the person to confirm.
create or replace function public.record_supplier_payment(p_supplier_id uuid, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; s public.suppliers%rowtype; v_before bigint; v_after bigint; v_id uuid;
begin
  if v_biz is null or v_role not in ('purchaser','owner','supa_admin') then raise exception 'Only purchasers and owners can record supplier payments.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  select * into s from public.suppliers where id = p_supplier_id and business_id = v_biz for update;
  if not found then raise exception 'Supplier not found.'; end if;
  v_before := public.supplier_balance_kobo(v_biz, s.id);
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo, note, recorded_by, recorded_by_name)
  values (v_biz, s.id, 'payment', p_amount_kobo, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), coalesce(v_name, 'Staff'))
  returning id into v_id;
  v_after := v_before - p_amount_kobo;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'supplier_payment_recorded', 'supplier_transactions', v_id,
          format('%s paid %s %s kobo (owed before %s, after %s)', coalesce(v_name, 'Staff'), s.name, p_amount_kobo, v_before, v_after));
  return jsonb_build_object('id', v_id, 'balance_before_kobo', v_before, 'balance_kobo', v_after, 'advance', v_after < 0);
end $function$;
revoke all on function public.record_supplier_payment(uuid, bigint, text) from public, anon;
grant execute on function public.record_supplier_payment(uuid, bigint, text) to authenticated, service_role;

-- 6. Reversing a payment: owner only, reason of 5 or more characters. The payment stays; an entry that puts the amount back is added beside it.
create or replace function public.reverse_supplier_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; p public.supplier_transactions%rowtype; s public.suppliers%rowtype; v_id uuid; v_after bigint;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a payment.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into p from public.supplier_transactions where id = p_payment_id and business_id = v_biz;
  if not found then raise exception 'Payment not found.'; end if;
  if p.type <> 'payment' then raise exception 'Only a payment can be reversed.'; end if;
  select * into s from public.suppliers where id = p.supplier_id for update;
  if exists (select 1 from public.supplier_transactions where reverses_id = p.id) then raise exception 'This payment has already been reversed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo, reverses_id, reason, recorded_by, recorded_by_name)
  values (v_biz, p.supplier_id, 'reversal', p.amount_kobo, p.id, btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner'))
  returning id into v_id;
  v_after := public.supplier_balance_kobo(v_biz, p.supplier_id);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'supplier_payment_reversed', 'supplier_transactions', v_id,
          format('%s reversed a payment of %s kobo to %s: %s', coalesce(v_name, 'Owner'), p.amount_kobo, s.name, btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id, 'balance_kobo', v_after);
end $function$;
revoke all on function public.reverse_supplier_payment(uuid, text) from public, anon;
grant execute on function public.reverse_supplier_payment(uuid, text) to authenticated, service_role;
