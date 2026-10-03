-- Read-only. Expect: write_policies 0, read_policies 1, delete_policies 0, triggers 2, audit_writers_not_definer 0.
-- audit_writers_not_definer counts functions that write audit lines but do NOT run as the database owner. If it is above 0, dropping the insert rule would break them.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='audit_logs' and cmd in ('INSERT','UPDATE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='audit_logs' and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='audit_logs' and cmd = 'DELETE') as delete_policies,
  (select count(*) from pg_trigger where tgrelid='public.audit_logs'::regclass and not tgisinternal and tgname in ('audit_logs_no_direct_insert','audit_logs_no_change')) as triggers,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_logs' and not p.prosecdef) as audit_writers_not_definer;
