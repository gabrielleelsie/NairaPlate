-- Read-only. Expect: write_policies 0, read_policies 1, delete_policies 0.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='customer_credits' and cmd in ('INSERT','UPDATE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='customer_credits' and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='customer_credits' and cmd = 'DELETE') as delete_policies;
