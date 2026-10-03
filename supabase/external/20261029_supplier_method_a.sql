-- NairaPlate Step 8 follow-up, part A: every supplier payment records HOW it was paid.
-- Run once in the Supabase SQL editor, BEFORE the new Pay a supplier screen is released. Safe to re-run. Rollback: 20261029_supplier_method_a_rollback.sql
-- Methods: cash_from_drawer (taken out of the open shift, saved together with the cash payout), cash_outside_drawer, bank_transfer, other (needs a note), legacy.
-- "legacy" is only written by the old screen's functions until part B removes them. It cannot be chosen by the new screen.
-- Payments made before this change have no method (left empty, not rewritten). The rule is NOT VALID, so it applies to every new row and does not re-check old ones.
-- Needs 20261020_supplier_ledger_a.sql and 20261028_cash_out_a.sql.

-- 1. The column and its rules.
alter table public.supplier_transactions add column if not exists payment_method text;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_method_rule;
alter table public.supplier_transactions add constraint supplier_transactions_method_rule
  check (type <> 'payment' or coalesce(payment_method, '') in ('cash_from_drawer','cash_outside_drawer','bank_transfer','other','legacy')) not valid;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_method_only_payment;
alter table public.supplier_transactions add constraint supplier_transactions_method_only_payment
  check (type = 'payment' or payment_method is null) not valid;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_other_needs_note;
alter table public.supplier_transactions add constraint supplier_transactions_other_needs_note
  check (payment_method is distinct from 'other' or length(btrim(coalesce(note, ''))) >= 5) not valid;
-- The method cannot be edited afterwards: supplier entries are already frozen for every signed-in person (supplier_transactions_no_change).

-- 2. The one place a payment is written. Internal: no signed-in person can call it directly.
create or replace function public.record_supplier_payment_core(p_supplier_id uuid, p_amount_kobo bigint, p_note text, p_method text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; s public.suppliers%rowtype; v_before bigint; v_after bigint; v_id uuid;
begin
  if v_biz is null or v_role not in ('purchaser','owner','supa_admin') then raise exception 'Only purchasers and owners can record supplier payments.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if p_method is null or p_method not in ('cash_from_drawer','cash_outside_drawer','bank_transfer','other','legacy') then raise exception 'Choose how this payment was made.'; end if;
  if p_method = 'other' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'For "Other", type a note of at least 5 characters saying how it was paid.'; end if;
  select * into s from public.suppliers where id = p_supplier_id and business_id = v_biz for update;
  if not found then raise exception 'Supplier not found.'; end if;
  v_before := public.supplier_balance_kobo(v_biz, s.id);
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo, note, recorded_by, recorded_by_name, payment_method)
  values (v_biz, s.id, 'payment', p_amount_kobo, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), coalesce(v_name, 'Staff'), p_method)
  returning id into v_id;
  v_after := v_before - p_amount_kobo;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'supplier_payment_recorded', 'supplier_transactions', v_id,
          format('%s paid %s %s kobo by %s (owed before %s, after %s)', coalesce(v_name, 'Staff'), s.name, p_amount_kobo,
                 case p_method when 'cash_from_drawer' then 'cash from the drawer' when 'cash_outside_drawer' then 'cash from outside the drawer' when 'bank_transfer' then 'bank transfer' when 'other' then 'another way' else 'an older screen' end,
                 v_before, v_after));
  return jsonb_build_object('id', v_id, 'balance_before_kobo', v_before, 'balance_kobo', v_after, 'advance', v_after < 0, 'payment_method', p_method);
end $function$;
revoke all on function public.record_supplier_payment_core(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.record_supplier_payment_core(uuid, bigint, text, text) to service_role;

-- 3. The old three-argument function keeps working for screens still open in a browser; its payments are marked legacy. Part B removes it.
create or replace function public.record_supplier_payment(p_supplier_id uuid, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public.record_supplier_payment_core(p_supplier_id, p_amount_kobo, p_note, 'legacy');
end $function$;
revoke all on function public.record_supplier_payment(uuid, bigint, text) from public, anon;
grant execute on function public.record_supplier_payment(uuid, bigint, text) to authenticated, service_role;

-- 4. "Paid from the cash drawer": the payment (method cash_from_drawer) and the cash taken out of the open shift are saved together, or neither is.
create or replace function public.record_supplier_payment_from_drawer(p_supplier_id uuid, p_amount_kobo bigint, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.cash_drawers%rowtype; v_res jsonb; v_tid uuid; v_sup text;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('purchaser','owner','supa_admin') then raise exception 'Only purchasers and owners can record a supplier payment.'; end if;
  select * into d from public.cash_drawers where business_id = v_biz and status = 'open' for update;
  if not found then raise exception 'There is no open shift, so this cannot be paid from the cash drawer. Open a shift first, or choose another way to pay.'; end if;
  v_res := public.record_supplier_payment_core(p_supplier_id, p_amount_kobo, p_note, 'cash_from_drawer');
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
revoke all on function public.record_supplier_payment_from_drawer(uuid, bigint, text) from public, anon;
grant execute on function public.record_supplier_payment_from_drawer(uuid, bigint, text) to authenticated;

-- 5. What the new screen calls: the person must choose a method. "legacy" cannot be chosen.
create or replace function public.record_supplier_payment_v2(p_supplier_id uuid, p_amount_kobo bigint, p_note text, p_method text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_method is null or p_method not in ('cash_from_drawer','cash_outside_drawer','bank_transfer','other') then raise exception 'Choose how this payment was made.'; end if;
  if p_method = 'other' and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'For "Other", type a note of at least 5 characters saying how it was paid.'; end if;
  if p_method = 'cash_from_drawer' then
    return public.record_supplier_payment_from_drawer(p_supplier_id, p_amount_kobo, p_note);
  end if;
  return public.record_supplier_payment_core(p_supplier_id, p_amount_kobo, p_note, p_method);
end $function$;
revoke all on function public.record_supplier_payment_v2(uuid, bigint, text, text) from public, anon;
grant execute on function public.record_supplier_payment_v2(uuid, bigint, text, text) to authenticated, service_role;
