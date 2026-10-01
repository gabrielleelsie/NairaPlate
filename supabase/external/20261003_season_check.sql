-- Read-only: confirms the season changes are installed. Expect: columns 3, new_log_purchase 1, old_log_purchase 0.
select
  (select count(*) from information_schema.columns where table_schema='public' and ((table_name='purchases' and column_name='season') or (table_name='ingredients' and column_name='current_season') or (table_name='ingredient_grade_prices' and column_name='season'))) as columns,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='log_purchase' and pg_get_function_identity_arguments(p.oid) like '%p_season%') as new_log_purchase,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='log_purchase' and pg_get_function_identity_arguments(p.oid) not like '%p_season%') as old_log_purchase;
