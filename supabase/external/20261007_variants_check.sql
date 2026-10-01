-- Read-only. Expect: dish_id_column 1, recipes_without_dish_id 0, variants_table 1, rls_on true, authenticated_can_write false, save_fn 1, delete_fn 1.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='recipes' and column_name='dish_id') as dish_id_column,
  (select count(*) from public.recipes where dish_id is null) as recipes_without_dish_id,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='recipe_variants') as variants_table,
  (select relrowsecurity from pg_class where oid='public.recipe_variants'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.recipe_variants', 'insert') as authenticated_can_write,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='save_recipe_variant') as save_fn,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='delete_recipe_variant') as delete_fn;
