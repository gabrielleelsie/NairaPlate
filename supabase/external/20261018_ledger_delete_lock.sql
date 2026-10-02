-- NairaPlate: nobody can delete these records from the browser. Void and refund records, customer debts, purchases, supplier balances,
-- cash drawers, channel payouts and staff are kept. People are deactivated, mistakes are corrected with a recorded entry, not erased.
-- Run once in the Supabase SQL editor. No code release is needed (no screen deletes any of these). Safe to re-run. Rollback: 20261018_ledger_delete_lock_rollback.sql
drop policy if exists order_adjustments_delete on public.order_adjustments;
drop policy if exists customer_credits_delete on public.customer_credits;
drop policy if exists purchases_delete on public.purchases;
drop policy if exists supplier_transactions_delete on public.supplier_transactions;
drop policy if exists cash_drawers_delete on public.cash_drawers;
drop policy if exists channel_payouts_delete on public.channel_payouts;
drop policy if exists staff_users_delete on public.staff_users;
