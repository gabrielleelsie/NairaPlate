-- Read-only. Expect: three tables 3, news_rls true, authenticated_can_write false, set_news_enabled_fn 1, scheduled_jobs 0 or 1 (1 once PART 2 is run).
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name in ('news_items','news_feed_status','business_news_prefs')) as three_tables,
  (select relrowsecurity from pg_class where oid='public.news_items'::regclass) as news_rls,
  has_table_privilege('authenticated', 'public.news_items', 'insert') as authenticated_can_write,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='set_news_enabled') as set_news_enabled_fn,
  (select count(*) from cron.job where jobname = 'nairaplate-news-watch') as scheduled_jobs;
