-- Read-only. Expect: scheduled_jobs 1, active true, calls_reminders true, schedule '0 * * * *'.
select
  (select count(*) from cron.job where jobname = 'nairaplate-expiry-reminders') as scheduled_jobs,
  (select active from cron.job where jobname = 'nairaplate-expiry-reminders') as active,
  (select schedule from cron.job where jobname = 'nairaplate-expiry-reminders') as schedule,
  (select command like '%/api/public/expiry-reminders%' from cron.job where jobname = 'nairaplate-expiry-reminders') as calls_reminders;
