-- Read-only. Expect: columns 3, both_checks true, setup_default_zero true, bad_rows 0, rls_on true, authenticated_can_read false.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscription_payments'
     and column_name in ('operating_mode', 'setup_fee_kobo', 'difference_reason')) as columns,
  (select count(*) = 2 from pg_constraint where conrelid = 'public.subscription_payments'::regclass
     and conname in ('subscription_payments_operating_mode_check', 'subscription_payments_setup_fee_check')) as both_checks,
  (select column_default = '0' and is_nullable = 'NO' from information_schema.columns
     where table_schema = 'public' and table_name = 'subscription_payments' and column_name = 'setup_fee_kobo') as setup_default_zero,
  (select count(*) from public.subscription_payments where setup_fee_kobo < 0 or setup_fee_kobo > amount_kobo
     or (operating_mode is not null and operating_mode not in ('buka', 'standard', 'advanced'))) as bad_rows,
  (select relrowsecurity from pg_class where oid = 'public.subscription_payments'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.subscription_payments', 'select') as authenticated_can_read;
