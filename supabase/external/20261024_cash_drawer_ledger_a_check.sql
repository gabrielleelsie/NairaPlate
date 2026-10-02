-- Read-only. Expect: new_columns 8, adjustments_table 1, one_open_index 1, triggers 2, functions 2, direct_write_policies_still_there 2 (closed in part B), most_open_per_business 1 (or 0 if none open).
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='cash_drawers' and column_name in ('opened_by_name','cash_sales_kobo','catering_cash_kobo','debt_cash_kobo','closed_by','closed_by_name','forced','close_reason')) as new_columns,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='cash_drawer_adjustments') as adjustments_table,
  (select count(*) from pg_indexes where schemaname='public' and indexname='cash_drawers_one_open') as one_open_index,
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('cash_drawers_protect','cash_drawer_adjustments_no_change')) as triggers,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('open_cash_drawer','adjust_closed_drawer')) as functions,
  (select count(*) from pg_policies where schemaname='public' and tablename='cash_drawers' and cmd in ('INSERT','UPDATE')) as direct_write_policies_still_there,
  (select coalesce(max(n), 0) from (select count(*) n from public.cash_drawers where status='open' group by business_id) x) as most_open_per_business;
