-- NairaPlate: kitchen operating profile (buka / standard / advanced) and wider per-kitchen feature switches.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261107_operating_mode_a_rollback.sql
-- Kitchens that already exist become 'advanced' (nothing changes for them). New kitchens start as 'buka'.
-- Only NairaPlate's server (service role) can change the profile; owners and staff can only read it.

-- 1. Profile column. Added with default 'advanced' so every existing row gets it, then the default moves to 'buka'.
alter table public.businesses
  add column if not exists operating_mode text not null default 'advanced';
alter table public.businesses alter column operating_mode set default 'buka';
alter table public.businesses drop constraint if exists businesses_operating_mode_check;
alter table public.businesses add constraint businesses_operating_mode_check
  check (operating_mode in ('buka', 'standard', 'advanced'));

-- 2. Signed-in users (owners included) cannot change the profile themselves.
create or replace function public.businesses_operating_mode_guard()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is not null and new.operating_mode is distinct from old.operating_mode then
    raise exception 'The kitchen profile can only be changed by NairaPlate';
  end if;
  return new;
end $function$;
drop trigger if exists businesses_operating_mode_guard on public.businesses;
create trigger businesses_operating_mode_guard before update on public.businesses
  for each row execute function public.businesses_operating_mode_guard();
revoke all on function public.businesses_operating_mode_guard() from public, anon, authenticated;

-- 3. Per-kitchen switches may now cover these five tools as well as catering.
alter table public.business_features drop constraint if exists business_features_feature_check;
alter table public.business_features add constraint business_features_feature_check
  check (feature in ('catering', 'customer_credit', 'receipt_capture', 'accountant_exports', 'margin_diagnostic'));
