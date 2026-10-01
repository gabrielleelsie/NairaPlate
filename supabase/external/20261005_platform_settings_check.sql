-- Read-only: confirms the platform settings are installed. Expect: table 1, function 1, rls_on true, signed-in users can read table false.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='platform_settings') as table_exists,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='public_settings') as function_exists,
  (select relrowsecurity from pg_class where oid='public.platform_settings'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.platform_settings', 'select') as authenticated_can_read_table;
