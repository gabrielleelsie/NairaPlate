-- Read-only. Expect: log_table 1, rls_on true, signed-in users can read false, scheduled_jobs 0 or 1 (1 once PART 2 is run).
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='subscription_reminder_log') as log_table,
  (select relrowsecurity from pg_class where oid='public.subscription_reminder_log'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.subscription_reminder_log', 'select') as authenticated_can_read,
  (select count(*) from cron.job where jobname = 'nairaplate-expiry-reminders') as scheduled_jobs;
