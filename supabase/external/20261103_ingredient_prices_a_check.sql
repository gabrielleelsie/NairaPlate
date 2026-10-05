-- Read-only check for 20261103_ingredient_prices_a.sql. Changes nothing.
-- Expected: history_table 1, rls_on true, app_can_select false, app_can_insert false, anon_can_read_fn false,
--           new_functions 5, rules 4, ingredients_priced_without_history 0, grade_prices_without_history 0,
--           current_prices_out_of_step 0. The remaining columns are the backfill report (information only).
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ingredient_price_history') as history_table,
  (select relrowsecurity from pg_class where oid = 'public.ingredient_price_history'::regclass) as rls_on,
  has_table_privilege('authenticated', 'public.ingredient_price_history', 'select') as app_can_select,
  has_table_privilege('authenticated', 'public.ingredient_price_history', 'insert') as app_can_insert,
  has_function_privilege('anon', 'public.ingredient_price_at(uuid,text,timestamptz)', 'execute') as anon_can_read_fn,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
     ('ingredient_price_history_protect','purchases_record_price_history','ingredients_require_price_history',
      'ingredient_price_history_for','ingredient_price_at')) as new_functions,
  (select count(*) from pg_trigger where tgname in ('ingredient_price_history_protect','ingredient_price_history_no_truncate',
     'purchases_record_price_history','ingredients_require_price_history')) as rules,
  (select count(*) from public.ingredients i where i.current_cost_kobo > 0
      and not exists (select 1 from public.ingredient_price_history h where h.ingredient_id = i.id and h.price_track = 'current')) as ingredients_priced_without_history,
  (select count(*) from public.ingredient_grade_prices g where g.cost_kobo > 0
      and not exists (select 1 from public.ingredient_price_history h where h.ingredient_id = g.ingredient_id and h.price_track = g.grade)) as grade_prices_without_history,
  (select count(*) from public.ingredients i
     join lateral (select h.cost_per_base_unit_kobo c from public.ingredient_price_history h
                    where h.ingredient_id = i.id and h.price_track = 'current' order by h.effective_from desc, h.seq desc limit 1) l on true
    where l.c <> i.current_cost_kobo) as current_prices_out_of_step,
  -- backfill report
  (select count(distinct ingredient_id) from public.ingredient_price_history) as ingredients_covered,
  (select count(*) from public.ingredient_price_history where source_type = 'backfill_purchase') as rows_from_purchases,
  (select count(*) from public.ingredient_price_history where source_type = 'backfill_reversal') as rows_from_reversals,
  (select count(*) from public.ingredient_price_history where source_type = 'migration_baseline') as baselines,
  (select count(*) from public.ingredient_price_history where backfill_basis = 'known_from_migration') as baselines_known_only_from_today,
  (select count(*) from public.purchases where kind = 'purchase' and (base_qty is null or base_qty <= 0)) as old_purchases_skipped_no_base_qty,
  (select min(effective_from) from public.ingredient_price_history) as earliest_price_known;
