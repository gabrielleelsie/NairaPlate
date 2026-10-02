-- Read-only. Expect: direct_write_policies 0 (no insert or update policy left on orders or order_items), read_policies 2, delete_policies 2.
select
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd in ('INSERT','UPDATE')) as direct_write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd = 'DELETE') as delete_policies;
