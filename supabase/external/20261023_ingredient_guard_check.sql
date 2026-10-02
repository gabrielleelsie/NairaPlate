-- Read-only. Expect: triggers 2, guard_is_definer false, helpers 2, writers_ok 8, writers_total 8.
-- writers_ok counts the eight functions that change stock or price which are security definer and NOT owned by a client role. If it is below 8, the guard would block that function.
select
  (select count(*) from pg_trigger where tgrelid='public.ingredients'::regclass and not tgisinternal and tgname in ('ingredients_protect','ingredients_protect_delete')) as triggers,
  (select prosecdef from pg_proc where pronamespace='public'::regnamespace and proname='ingredients_protect') as guard_is_definer,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('ingredient_has_history','ingredient_ids_with_history')) as helpers,
  (select count(*) from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.pronamespace='public'::regnamespace and p.prosecdef and r.rolname not in ('authenticated','anon')
      and p.proname in ('apply_sale_stock','reverse_sale_stock','apply_wastage_stock','log_batch','apply_stock_count','log_purchase','reverse_purchase','set_ingredient_price')) as writers_ok,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('apply_sale_stock','reverse_sale_stock','apply_wastage_stock','log_batch','apply_stock_count','log_purchase','reverse_purchase','set_ingredient_price')) as writers_total;
