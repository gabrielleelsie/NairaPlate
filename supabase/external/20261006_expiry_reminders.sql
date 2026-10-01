-- NairaPlate expiry reminder emails: the send log, and (PART 2, commented out) the hourly schedule.
-- Run PART 1 any time. Run PART 2 only after the code is live. Reminders stay OFF until an admin switches them on in Settings.
-- Rollback: 20261006_expiry_reminders_rollback.sql

-- ============================== PART 1: schema ==============================
-- One row per business, plan period, kind and day-offset, claimed BEFORE sending, so a retried or overlapping run can never email twice.
-- A renewal changes access_ends_at, so the next period starts with a clean slate.
create table if not exists public.subscription_reminder_log (
  business_id text        not null references public.businesses(id) on delete cascade,
  period_end  timestamptz not null,
  kind        text        not null,
  offset_days integer     not null,
  recipients  integer     not null default 0,
  sent        integer     not null default 0,
  created_at  timestamptz not null default now(),
  primary key (business_id, period_end, kind, offset_days)
);
alter table public.subscription_reminder_log enable row level security;
revoke all on public.subscription_reminder_log from anon, authenticated;
grant all on public.subscription_reminder_log to service_role;
create index if not exists subscription_reminder_log_created_idx on public.subscription_reminder_log (created_at desc);

-- ============================== PART 2: schedule =============================
-- Uses the same two Vault secrets as the daily summary (already created). Runs at the top of every hour; the code only sends
-- in the hour chosen in Settings (default 9 in Nigeria time), so changing the hour needs no change here.
--
-- select cron.schedule(
--   'nairaplate-expiry-reminders',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url')
--            || '/api/public/expiry-reminders',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 60000
--   );
--   $$
-- );
