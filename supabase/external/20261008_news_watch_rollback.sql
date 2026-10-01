-- Undo the news watch. Saved headlines and each business's on/off choice are removed.
select cron.unschedule('nairaplate-news-watch') where exists (select 1 from cron.job where jobname = 'nairaplate-news-watch');
drop function if exists public.set_news_enabled(boolean);
drop table if exists public.business_news_prefs;
drop table if exists public.news_feed_status;
drop table if exists public.news_items;
delete from public.platform_settings where key = 'news';
