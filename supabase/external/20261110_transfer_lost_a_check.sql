-- Read-only check for 20261110_transfer_lost_a.sql. Changes nothing.
-- Expected single row:  true, true, true, true, false, false, true, true, 0
select
  (select pg_get_constraintdef(oid) like '%transfer_lost%' from pg_constraint where conname = 'orders_status_check_v2' and conrelid = 'public.orders'::regclass) as status_allowed,
  to_regclass('public.paper_transfer_losses') is not null                                                    as loss_table,
  (select relrowsecurity from pg_class where oid = 'public.paper_transfer_losses'::regclass)                  as table_row_security_on,
  to_regprocedure('public.mark_paper_transfer_lost(uuid,text)') is not null                                  as function_exists,
  has_function_privilege('anon', 'public.mark_paper_transfer_lost(uuid,text)', 'execute')                     as visitor_can_run_it,
  has_table_privilege('authenticated', 'public.paper_transfer_losses', 'insert')                              as app_can_write_losses,
  (select prosrc like '%mark the transfer as lost if it never arrives%' from pg_proc where oid = 'public.cancel_unpaid_order(uuid,text)'::regprocedure) as cancel_message_updated,
  (select count(*) = 2 from pg_trigger where tgrelid = 'public.paper_transfer_losses'::regclass and not tgisinternal) as loss_table_guards,
  (select count(*) from public.orders where status = 'transfer_lost' and not exists (select 1 from public.paper_transfer_losses l where l.order_id = orders.id)) as lost_orders_without_record;
