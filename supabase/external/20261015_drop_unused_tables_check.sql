-- Read-only. Expect: sales_orders_exists false.
select to_regclass('public.sales_orders') is not null as sales_orders_exists;
