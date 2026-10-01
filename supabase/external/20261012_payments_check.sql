-- Read-only. Expect: tables 3, rls_on true, six_functions 8 (see list), authenticated_can_write false, anon_can_run false, guard_trigger 1.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in ('business_payment_settings','payment_requests','payment_events')) as tables,
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.business_payment_settings'::regclass,'public.payment_requests'::regclass,'public.payment_events'::regclass)) as rls_on,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('payment_mode_of','set_payment_mode','cancel_unpaid_order','save_payment_connection','read_payment_connection','create_transfer_order','attach_payment_account','record_provider_payment')) as functions_expect_8,
  has_table_privilege('authenticated','public.payment_requests','insert') as authenticated_can_write,
  has_function_privilege('anon','public.record_provider_payment(text,text,text,bigint,jsonb)','execute') as anon_can_record,
  has_function_privilege('authenticated','public.read_payment_connection(text)','execute') as authenticated_can_read_keys,
  (select count(*) from pg_trigger where not tgisinternal and tgname='orders_payment_guard') as guard_trigger;
