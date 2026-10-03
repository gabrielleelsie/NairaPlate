-- Rollback for Step 8 part A. REFUSES (changes nothing) if any payout entry or limit setting exists, because that would lose real records.
-- Run part B's rollback first if part B was run. All or nothing.
do $rb$ begin
  if exists (select 1 from public.cash_drawer_payouts) or exists (select 1 from public.drawer_settings) then
    raise exception 'Cash payout entries or settings exist. Rolling back would lose them. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_catering_order' and p.pronargs = 11) then
    raise exception 'Part B is still in place (the old catering order function is gone). Run 20261028_cash_out_b_rollback.sql first. Nothing was changed.';
  end if;
  drop trigger if exists purchases_cash_payout_follow on public.purchases;
  drop trigger if exists supplier_transactions_cash_payout_follow on public.supplier_transactions;
  drop trigger if exists cash_drawers_pending_guard on public.cash_drawers;
  drop function if exists public.cash_payout_follow_reversal();
  drop function if exists public.cash_drawers_pending_guard();
  drop function if exists public.set_drawer_payout_limit(bigint);
  drop function if exists public.record_cash_payout(bigint, text, text);
  drop function if exists public.approve_cash_payout(uuid);
  drop function if exists public.decline_cash_payout(uuid, text);
  drop function if exists public.reverse_cash_payout(uuid, text);
  drop function if exists public.log_purchase_from_drawer(uuid, numeric, text, bigint, text, text, text, text, uuid);
  drop function if exists public.record_supplier_payment_from_drawer(uuid, bigint, text);
  drop function if exists public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text, text);
  drop table if exists public.cash_drawer_payouts;
  drop table if exists public.drawer_settings;
  alter table public.cash_drawers drop column if exists payouts_kobo;
end $rb$;
