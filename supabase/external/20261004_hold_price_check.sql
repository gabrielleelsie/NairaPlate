-- Read-only: confirms the Hold my price columns are installed. Expect: 2 columns, and save_recipe_version mentions min_quantity (1).
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='recipe_items' and column_name in ('min_quantity','never_cut')) as columns,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='save_recipe_version' and prosrc like '%min_quantity%') as save_knows_minimums;
