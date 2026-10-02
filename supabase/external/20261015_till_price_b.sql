-- NairaPlate Till price path, part B: close the old direct write path to sales.
-- Run ONLY AFTER the new Till code is live (it saves sales through create_cash_order). Safe to re-run. Rollback: 20261015_till_price_b_rollback.sql
-- After this, nobody can insert or edit orders and order lines straight from the browser. Sales are made by the database functions
-- (cash and split, credit, automatic transfer), voided or refunded by adjust_order, cancelled by cancel_unpaid_order,
-- and marked paid by the bank message. Owner delete is left as it is.
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists order_items_insert on public.order_items;
drop policy if exists order_items_update on public.order_items;
