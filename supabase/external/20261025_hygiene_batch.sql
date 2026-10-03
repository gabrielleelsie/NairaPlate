-- NairaPlate Step 6 sweep, low-risk hygiene batch (B1 to B3). Changes who is ALLOWED to try things. It changes no data and no rules the screens use.
-- B1: signed-out visitors keep no privileges on any public table (row security already refuses them; this removes the grants too).
-- B2: signed-in users lose TRUNCATE, TRIGGER and REFERENCES on public tables (they keep select, insert, update, delete; row security still decides rows).
-- B3: signed-out visitors and "public" can no longer be given execute on trigger functions (triggers still fire; they are not called by people).
-- A snapshot of today's grants is saved first so the rollback can restore them exactly. Run once in the Supabase SQL editor. Safe to re-run.
-- Rollback: 20261025_hygiene_batch_rollback.sql

-- 0. Snapshot (kept private: no access for anyone but the server).
create table if not exists public.grant_backup_20261025 (grantee text not null, table_name text not null, privilege text not null, primary key (grantee, table_name, privilege));
alter table public.grant_backup_20261025 enable row level security;
revoke all on public.grant_backup_20261025 from anon, authenticated;
grant all on public.grant_backup_20261025 to service_role;
create table if not exists public.function_grant_backup_20261025 (function_signature text primary key);
alter table public.function_grant_backup_20261025 enable row level security;
revoke all on public.function_grant_backup_20261025 from anon, authenticated;
grant all on public.function_grant_backup_20261025 to service_role;
insert into public.grant_backup_20261025 (grantee, table_name, privilege)
  select g.grantee, g.table_name, g.privilege_type from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee in ('anon','authenticated') and g.table_name not in ('grant_backup_20261025','function_grant_backup_20261025')
  on conflict do nothing;
insert into public.function_grant_backup_20261025 (function_signature)
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype = 'trigger'::regtype
  on conflict do nothing;

-- B1
revoke all on all tables in schema public from anon;
-- B2
revoke truncate, trigger, references on all tables in schema public from authenticated;
-- B3
do $b3$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $b3$;
