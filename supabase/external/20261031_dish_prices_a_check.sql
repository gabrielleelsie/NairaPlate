-- Read-only check for 20261031_dish_prices_a.sql. Expected: history_table 1, dishes_without_price 0, new_functions 6,
-- anon_can_set false, browser_can_insert false, recipe_rule 1, line_rule 1, once_functions_apply 3.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='dish_prices') as history_table,
  (select count(*) from (select distinct dish_id from public.recipes where is_current and dish_id is not null and selling_price_kobo > 0) d
     where not exists (select 1 from public.dish_prices p where p.dish_id = d.dish_id and p.cancelled_at is null)) as dishes_without_price,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
     ('dish_price_at','apply_due_dish_prices','refresh_dish_prices','set_dish_price','cancel_dish_price','recipes_record_price')) as new_functions,
  has_function_privilege('anon','public.set_dish_price(uuid,bigint,timestamptz)','execute') as anon_can_set,
  has_table_privilege('authenticated','public.dish_prices','insert') as browser_can_insert,
  (select count(*) from pg_trigger where tgname='recipes_record_price') as recipe_rule,
  (select count(*) from pg_trigger where tgname='order_items_set_dish_price') as line_rule,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'create_%_order_once'
     and prosrc like '%apply_due_dish_prices%') as once_functions_apply;
