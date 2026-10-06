-- NairaPlate: three columns on subscription_payments so a payment records which plan type it was for, how much of it was the setup fee,
-- and why the amount differed from the price list (if it did).
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261114_payment_columns_a_rollback.sql
-- Existing rows keep working: operating_mode and difference_reason stay empty, setup_fee_kobo is 0.
-- amount_kobo stays the total the customer paid. The plan part is amount_kobo minus setup_fee_kobo.
-- Run this BEFORE the matching code is released: the new code writes these columns.

alter table public.subscription_payments add column if not exists operating_mode    text;
alter table public.subscription_payments add column if not exists setup_fee_kobo    bigint not null default 0;
alter table public.subscription_payments add column if not exists difference_reason text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_operating_mode_check' and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_operating_mode_check
      check (operating_mode is null or operating_mode in ('buka', 'standard', 'advanced'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_setup_fee_check' and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_setup_fee_check
      check (setup_fee_kobo >= 0 and setup_fee_kobo <= amount_kobo);
  end if;
end
$do$;
