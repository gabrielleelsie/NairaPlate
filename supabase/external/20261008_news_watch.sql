-- NairaPlate news watch: headlines about fuel, transport, rice, pepper, tomatoes and onions price changes.
-- PART 1 any time. PART 2 (the hourly schedule) only after the code is live. Rollback: 20261008_news_watch_rollback.sql
-- Only the headline, outlet, date and link are stored. Nothing here changes any cost or price.

-- ============================== PART 1: schema ==============================
create table if not exists public.news_items (
  id           uuid        primary key default gen_random_uuid(),
  url          text        not null unique,
  title        text        not null,
  source       text        not null,
  published_at timestamptz not null,
  topics       text[]      not null,
  rising       boolean     not null default false,
  fetched_at   timestamptz not null default now()
);
create index if not exists news_items_published_idx on public.news_items (published_at desc);
alter table public.news_items enable row level security;
drop policy if exists news_items_select on public.news_items;
create policy news_items_select on public.news_items
  for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser','cook','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id')))
  );
revoke all on public.news_items from anon, authenticated;
grant select on public.news_items to authenticated;
grant all on public.news_items to service_role;

-- Per outlet: did the last read work? Server only, so the admin console can show which feeds fail.
create table if not exists public.news_feed_status (
  source           text        primary key,
  feed_url         text        not null,
  checked_at       timestamptz not null default now(),
  last_ok_at       timestamptz,
  last_error       text,
  last_item_count  integer     not null default 0,
  last_match_count integer     not null default 0
);
alter table public.news_feed_status enable row level security;
revoke all on public.news_feed_status from anon, authenticated;
grant all on public.news_feed_status to service_role;

-- A business can switch the news off for its staff. No row = on.
create table if not exists public.business_news_prefs (
  business_id text        primary key references public.businesses(id) on delete cascade,
  enabled     boolean     not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.business_news_prefs enable row level security;
drop policy if exists business_news_prefs_select on public.business_news_prefs;
create policy business_news_prefs_select on public.business_news_prefs
  for select to authenticated
  using (
    business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id')))
  );
revoke all on public.business_news_prefs from anon, authenticated;
grant select on public.business_news_prefs to authenticated;
grant all on public.business_news_prefs to service_role;

create or replace function public.set_news_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
BEGIN
  IF v_biz IS NULL OR v_role NOT IN ('owner','supa_admin') THEN RAISE EXCEPTION 'Only an owner can switch the news on or off.'; END IF;
  IF NOT (select public.business_has_access(v_biz)) THEN RAISE EXCEPTION 'Your plan has ended.'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose on or off.'; END IF;
  INSERT INTO business_news_prefs (business_id, enabled, updated_at, updated_by)
  VALUES (v_biz, p_enabled, now(), auth.uid())
  ON CONFLICT (business_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = auth.uid();
END $function$;
revoke all on function public.set_news_enabled(boolean) from public, anon;
grant execute on function public.set_news_enabled(boolean) to authenticated, service_role;

-- ============================== PART 2: schedule =============================
-- Uses the same two Vault secrets as the daily summary (already created). Hourly, at 20 minutes past.
--
-- select cron.schedule(
--   'nairaplate-news-watch',
--   '20 * * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url')
--            || '/api/public/news-watch',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 60000
--   );
--   $$
-- );
