-- Read-only. Expect: event_time_col 1, log_table 1, rls_on true, alerts_fn 1, anon_can_run false.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='catering_deposits' and column_name='event_time') as event_time_col,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='catering_reminder_log') as log_table,
  (select relrowsecurity from pg_class where oid='public.catering_reminder_log'::regclass) as rls_on,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='raise_catering_alerts') as alerts_fn,
  has_function_privilege('anon','public.raise_catering_alerts()','execute') as anon_can_run;
