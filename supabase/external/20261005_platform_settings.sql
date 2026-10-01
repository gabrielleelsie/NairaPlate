-- NairaPlate platform settings: plan prices and customer-facing wording that a platform admin can change without a code change.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261005_platform_settings_rollback.sql
-- Nothing changes for anyone until an admin saves a setting: every screen has built-in default wording.

create table if not exists public.platform_settings (
  key             text        primary key,
  value           jsonb       not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text
);

-- Server only, like subscription_payments: RLS on, no policies, so signed-in users cannot read or write the table.
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant all on public.platform_settings to service_role;

-- What customers' screens are allowed to see: only the three public keys, never any other setting.
-- SECURITY DEFINER on purpose: an owner whose plan has ended is locked out of ordinary tables, but still has to see the locked screen.
create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from public.platform_settings
   where key in ('prices', 'locked_screen', 'expiry_banner');
$function$;
revoke all on function public.public_settings() from public, anon;
grant execute on function public.public_settings() to authenticated, service_role;
