-- Stops the hourly reminder job. Keeps the log table and the saved reminder settings.
select cron.unschedule('nairaplate-expiry-reminders') where exists (select 1 from cron.job where jobname = 'nairaplate-expiry-reminders');
