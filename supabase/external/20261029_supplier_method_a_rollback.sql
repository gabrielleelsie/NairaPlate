-- Rollback for the supplier payment method, part A. Refuses once any payment carries a method (dropping the column would lose that record).
-- Everything below is one transaction: if the check refuses, nothing is changed.
begin;
do $$ begin
  if exists (select 1 from public.supplier_transactions where payment_method is not null) then
    raise exception 'Payments with a method exist. Rolling back would lose that record. Nothing was changed.';
  end if;
end $$;
-- Put the cash-drawer function back to calling the three-argument function, and that function back to writing the payment itself.
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
revoke all on function public.record_supplier_payment_from_drawer(uuid, bigint, text) from public, anon;
grant execute on function public.record_supplier_payment_from_drawer(uuid, bigint, text) to authenticated;

drop function if exists public.record_supplier_payment_v2(uuid, bigint, text, text);
drop function if exists public.record_supplier_payment_core(uuid, bigint, text, text);
alter table public.supplier_transactions drop constraint if exists supplier_transactions_method_rule;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_method_only_payment;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_other_needs_note;
alter table public.supplier_transactions drop column if exists payment_method;
commit;
