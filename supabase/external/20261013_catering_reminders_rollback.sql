-- select cron.unschedule('nairaplate-catering-alerts');
-- select cron.unschedule('nairaplate-catering-morning');
-- select cron.unschedule('nairaplate-catering-evening');
drop function if exists public.raise_catering_alerts();
drop table if exists public.catering_reminder_log;
alter table public.catering_deposits drop column if exists event_time;
