-- Read-only: confirms the grade costing changes are installed. Expect: 1, 1, 1, 1, 1, 0 (old 6-argument save_recipe_version gone).
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='recipes' and column_name='cost_grade') as recipes_cost_grade,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='cost_per_plate_kobo') as order_items_cost,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='recipe_plate_cost_kobo') as cost_fn,
  (select count(*) from pg_trigger where tgrelid='public.order_items'::regclass and tgname='order_items_lock_cost') as lock_trigger,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='save_recipe_version' and pg_get_function_identity_arguments(p.oid) like '%p_cost_grade%') as new_save,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='save_recipe_version' and pg_get_function_identity_arguments(p.oid) not like '%p_cost_grade%') as old_save;
