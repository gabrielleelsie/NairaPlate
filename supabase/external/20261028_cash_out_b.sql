-- NairaPlate Step 8, part B: a catering deposit can no longer be saved without a payment method.
-- Run ONLY AFTER the new catering screen is live (it calls the new order function with the deposit method). Safe to re-run.
-- Rollback: 20261028_cash_out_b_rollback.sql
-- The two deposits recorded before methods existed are marked carried over and are left as they are. Any deposit saved without a method between
-- part A and part B (by the old screen) is also left as it is: the rule is NOT VALID, so it applies to every new row but does not re-check old ones.
drop function if exists public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text);
alter table public.catering_payments drop constraint if exists catering_payments_deposit_method_rule;
alter table public.catering_payments add constraint catering_payments_deposit_method_rule
  check (kind <> 'deposit' or carried_over or method is not null) not valid;
