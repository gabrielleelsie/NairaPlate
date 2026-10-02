-- Read-only. Expect: anon_table_grants 0, authenticated_risky_grants 0, anon_can_run_trigger_functions 0, app_privileges_kept true.
select
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon') as anon_table_grants,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')) as authenticated_risky_grants,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.prorettype='trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')) as anon_can_run_trigger_functions,
  ((select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE'))
    = (select count(*) from public.grant_backup_20261025 where grantee='authenticated' and privilege in ('SELECT','INSERT','UPDATE','DELETE'))) as app_privileges_kept;
