-- Read-only. Expect: write_policies 0, read_policies 1, delete_policies 0, guard_updated true.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='cash_drawers' and cmd in ('INSERT','UPDATE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='cash_drawers' and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='cash_drawers' and cmd = 'DELETE') as delete_policies,
  (select position('opened from the drawer screen' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='cash_drawers_protect') as guard_updated;
