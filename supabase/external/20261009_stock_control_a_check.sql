-- Read-only. Expect: movements_table 1, rls_on true, authenticated_can_write false, stock_mode_column 1, five_triggers 5 (ingredients, order_items, orders, batches, wastage x2 = 6 rows, see below), opening_rows = number of ingredients with stock.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='stock_movements') as movements_table,
  (select relrowsecurity from pg_class where oid='public.stock_movements'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.stock_movements', 'insert') as authenticated_can_write,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='recipes' and column_name='stock_mode') as stock_mode_column,
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('ingredients_log_stock','order_items_apply_stock','orders_reverse_stock','batches_stock_mode_check','wastage_logs_apply_stock','wastage_logs_restore_stock')) as six_triggers,
  (select count(*) from public.stock_movements where reason = 'opening_balance') as opening_rows,
  (select count(*) from public.ingredients where stock_base_qty <> 0) as ingredients_with_stock;
