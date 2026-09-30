-- Daily summary email: schema + evening schedule for the EXTERNAL NairaPlate database
-- (project ckklehqascyglqnqtwpn). Lives outside supabase/migrations so Lovable Cloud never runs it.
-- Apply PART 1 any time. Apply PART 2 only after DAILY_SUMMARY_SECRET is set in Cloudflare
-- and the code that serves /api/public/daily-summary is live.

-- ============================== PART 1: schema ==============================
begin;

-- Owners can switch the summary off (Staff screen or the unsubscribe link). On by default.
alter table public.businesses
  add column if not exists daily_summary_enabled boolean not null default true;

-- One row per business per Nigeria day, claimed before sending, so a summary is never sent twice.
create table if not exists public.daily_summary_log (
  business_id  text        not null references public.businesses(id) on delete cascade,
  summary_date date        not null,          -- the Nigeria (WAT) calendar date
  recipients   integer     not null default 0,
  sent         integer     not null default 0,
  created_at   timestamptz not null default now(),
  primary key (business_id, summary_date)
);

-- Server only: RLS on and no policies, so signed-in users can neither read nor write it.
alter table public.daily_summary_log enable row level security;
revoke all on public.daily_summary_log from anon, authenticated;

commit;

-- ============================== PART 2: schedule =============================
-- Replace the two placeholders before running. The secret must be exactly the value set as
-- DAILY_SUMMARY_SECRET in Cloudflare. Both are stored in Supabase Vault, never in the job text.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select vault.create_secret('https://<LIVE SITE DOMAIN>', 'nairaplate_site_url');
-- select vault.create_secret('<DAILY_SUMMARY_SECRET>',   'nairaplate_daily_summary_secret');
--
-- 19:00 UTC = 20:00 Nigeria time (WAT is UTC+1 all year). pg_cron on Supabase runs in UTC.
-- select cron.schedule(
--   'nairaplate-daily-summary',
--   '0 19 * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url')
--            || '/api/public/daily-summary',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 60000
--   );
--   $$
-- );

-- ============================== ROLLBACK (only if needed) ====================
-- select cron.unschedule('nairaplate-daily-summary');
-- delete from vault.secrets where name in ('nairaplate_site_url', 'nairaplate_daily_summary_secret');
-- drop table if exists public.daily_summary_log;
-- alter table public.businesses drop column if exists daily_summary_enabled;
