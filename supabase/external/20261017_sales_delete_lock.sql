-- NairaPlate: nobody can delete sales from the browser. A wrong sale is voided or refunded (with a reason, kept in the record), never erased.
-- Run once in the Supabase SQL editor. No code release is needed (no screen deletes sales). Safe to re-run. Rollback: 20261017_sales_delete_lock_rollback.sql
drop policy if exists orders_delete on public.orders;
drop policy if exists order_items_delete on public.order_items;
