-- Read-only. Expect: trigger_count 1, function_count 1.
select
  (select count(*) from pg_trigger where not tgisinternal and tgname = 'stock_movements_alerts') as trigger_count,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'raise_stock_alerts') as function_count;
select count(*) as purchaser_policies_expect_2 from pg_policy where polrelid = 'public.margin_flags'::regclass and polname like '%purchaser';
