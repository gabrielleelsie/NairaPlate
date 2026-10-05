-- Expected: true | buka | 0 | true | true | (number of kitchens) | 0
select
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='operating_mode' and is_nullable='NO') as column_ok,
  (select column_default from information_schema.columns where table_schema='public' and table_name='businesses' and column_name='operating_mode') like '%buka%' as default_is_buka_text,
  (select count(*) from public.businesses where operating_mode not in ('buka','standard','advanced')) as bad_rows,
  exists (select 1 from pg_trigger where tgname='businesses_operating_mode_guard' and not tgisinternal) as guard_on,
  pg_get_constraintdef((select oid from pg_constraint where conname='business_features_feature_check')) like '%margin_diagnostic%' as features_widened,
  (select count(*) from public.businesses where operating_mode='advanced') as advanced_kitchens,
  (select count(*) from public.businesses where operating_mode<>'advanced') as other_kitchens;
