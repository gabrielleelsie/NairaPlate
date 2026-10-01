-- Read-only: confirms the grade changes are installed. Expect: columns 2, table 1, new_log_purchase 1, old_log_purchase 0.
select
  (select count(*) from information_schema.columns where table_schema='public' and ((table_name='purchases' and column_name='grade') or (table_name='ingredients' and column_name='current_grade'))) as columns,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='ingredient_grade_prices') as grade_price_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='log_purchase' and pg_get_function_identity_arguments(p.oid) like '%p_grade%') as new_log_purchase,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='log_purchase' and pg_get_function_identity_arguments(p.oid) not like '%p_grade%') as old_log_purchase;
