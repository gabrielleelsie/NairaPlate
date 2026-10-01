-- Read-only. Expect: tables 2, rls_on true, authenticated_can_write false, submit_fn 1, decide_fn 1.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in ('stock_counts','stock_count_lines')) as tables,
  (select relrowsecurity from pg_class where oid='public.stock_counts'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.stock_counts', 'insert') as authenticated_can_write,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='submit_stock_count') as submit_fn,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='decide_stock_count') as decide_fn;
