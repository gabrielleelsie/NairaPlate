-- Undo the expiry reminders. The saved reminder settings row (key 'reminders' in platform_settings) is removed too.
select cron.unschedule('nairaplate-expiry-reminders') where exists (select 1 from cron.job where jobname = 'nairaplate-expiry-reminders');
drop table if exists public.subscription_reminder_log;
delete from public.platform_settings where key = 'reminders';
