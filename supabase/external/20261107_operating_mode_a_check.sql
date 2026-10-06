-- Run AFTER 20261107_operating_mode_a.sql. Works even if the migration has not run (column_ok = false, counts = 0).
-- Expected: true | true | 0 | true | true | (number of kitchens) | 0
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='operating_mode' and is_nullable='NO') as column_ok,
  coalesce((select column_default from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='operating_mode') like '%buka%', false) as default_is_buka,
  (select count(*) from public.businesses b where to_jsonb(b) ? 'operating_mode' and coalesce(to_jsonb(b)->>'operating_mode','') not in ('buka','standard','advanced')) as bad_rows,
  exists (select 1 from pg_trigger where tgname='businesses_operating_mode_guard' and not tgisinternal) as guard_on,
  coalesce(pg_get_constraintdef((select oid from pg_constraint where conname='business_features_feature_check')) like '%margin_diagnostic%', false) as features_widened,
  (select count(*) from public.businesses b where to_jsonb(b)->>'operating_mode'='advanced') as advanced_kitchens,
  (select count(*) from public.businesses b where to_jsonb(b) ? 'operating_mode' and to_jsonb(b)->>'operating_mode'<>'advanced') as other_kitchens;
