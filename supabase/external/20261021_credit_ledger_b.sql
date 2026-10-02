-- NairaPlate append-only records, step 3, part B: close the old direct write path to customer debts.
-- Run ONLY AFTER the new credit screen is live (it records payments, write-offs and manual debts through the database functions).
-- Safe to re-run. Rollback: 20261021_credit_ledger_b_rollback.sql
drop policy if exists customer_credits_insert on public.customer_credits;
drop policy if exists customer_credits_update on public.customer_credits;
-- Defence in depth: even if a policy is added back by mistake, a signed-in person can only change a debt through the functions above.
create or replace function public.customer_credits_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null or current_setting('app.credit_internal', true) = '1' then return NEW; end if;
  raise exception 'A debt can only be changed by recording a payment, a write-off or a correction.';
end $function$;
