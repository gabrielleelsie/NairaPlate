-- NairaPlate expiry reminders: switch on the hourly schedule (PART 2 of 20261006_expiry_reminders.sql, which was never run).
-- Run once in the Supabase SQL editor. Safe to re-run: it does nothing if the job already exists.
-- Rollback: 20261113_expiry_reminders_schedule_rollback.sql
-- Nothing is emailed yet. The job only calls the site once an hour, and the site sends nothing until an admin
-- switches "Reminder emails" on in Platform settings (it is off until then).
-- Same pattern and the same two Vault secrets as the live jobs nairaplate-daily-summary and nairaplate-news-watch.

do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'nairaplate-expiry-reminders') then
    perform cron.schedule(
      'nairaplate-expiry-reminders',
      '0 * * * *',
      $cmd$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url')
               || '/api/public/expiry-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
      $cmd$
    );
  end if;
end
$do$;
