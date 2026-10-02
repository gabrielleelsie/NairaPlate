-- Read-only. Expect: delete_policies 0, read_policies 2, write_policies 0.
select
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd = 'DELETE') as delete_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('orders','order_items') and cmd in ('INSERT','UPDATE')) as write_policies;
