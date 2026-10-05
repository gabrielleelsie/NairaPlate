-- Read-only check for 20261107_paper_rules_a.sql. Changes nothing.
-- Expected single row:  true, true, true, false, false, true, true, true, true, true, 0
select
  to_regclass('public.paper_transfer_confirmations') is not null                                              as confirmations_table,
  (select relrowsecurity from pg_class where oid = 'public.paper_transfer_confirmations'::regclass)           as table_row_security_on,
  to_regprocedure('public.confirm_paper_transfer(uuid,text,text)') is not null                                 as confirm_function_exists,
  has_function_privilege('anon', 'public.confirm_paper_transfer(uuid,text,text)', 'execute')                   as visitor_can_confirm,
  has_table_privilege('authenticated', 'public.paper_transfer_confirmations', 'insert')                        as app_can_write_confirmations,
  (select prosrc like '%outside_shift_cash%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as approval_knows_outside_shift,
  (select prosrc like '%e.payment_method in (''transfer'', ''split'')%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as split_waits_for_transfer,
  (select prosrc not like '%v_cur_open_shift is null%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as open_shift_at_approval_not_used,
  (select prosrc like '%Cash was already taken for this paper sale%' from pg_proc where oid = 'public.cancel_unpaid_order(uuid,text)'::regprocedure) as cancel_guard_in_place,
  (select pg_get_constraintdef(oid) like '%outside_shift_cash%' from pg_constraint where conname = 'late_entries_shift_resolution_check') as resolution_allows_outside_shift,
  (select count(*) from public.orders where is_late_entry and status = 'paid' and payment_method in ('transfer','split')
      and not exists (select 1 from public.paper_transfer_confirmations c where c.order_id = orders.id))       as paid_paper_transfers_without_confirmation;
