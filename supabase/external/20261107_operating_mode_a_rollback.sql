-- Undo 20261107_operating_mode_a.sql. Removes extra switches first so the old catering-only rule fits.
delete from public.business_features where feature <> 'catering';
alter table public.business_features drop constraint if exists business_features_feature_check;
alter table public.business_features add constraint business_features_feature_check check (feature in ('catering'));
drop trigger if exists businesses_operating_mode_guard on public.businesses;
drop function if exists public.businesses_operating_mode_guard();
alter table public.businesses drop constraint if exists businesses_operating_mode_check;
alter table public.businesses drop column if exists operating_mode;
