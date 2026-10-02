-- NairaPlate: drop the unused empty table sales_orders (no code, no foreign key, no policy, 0 rows when checked on 2 October 2026).
-- Refuses to run if it has gained any rows. Safe to re-run. Rollback: 20261015_drop_unused_tables_rollback.sql
do $$ begin
  if to_regclass('public.sales_orders') is not null then
    if exists (select 1 from public.sales_orders) then raise exception 'sales_orders is not empty. Nothing was dropped.'; end if;
    drop table public.sales_orders;
  end if;
end $$;
