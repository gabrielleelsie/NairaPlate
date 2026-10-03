-- Read-only. Expect: tables_with_row_security 2, write_rules 0, triggers 5, payout_functions 7, catering_new_function 1, not_open_to_visitors true, payouts_column 1.
select
  (select count(*) from pg_tables where schemaname='public' and tablename in ('drawer_settings','cash_drawer_payouts') and rowsecurity) as tables_with_row_security,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('drawer_settings','cash_drawer_payouts') and cmd <> 'SELECT') as write_rules,
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('cash_drawer_payouts_no_direct_insert','cash_drawer_payouts_no_change','cash_drawers_pending_guard','purchases_cash_payout_follow','supplier_transactions_cash_payout_follow')) as triggers,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('set_drawer_payout_limit','record_cash_payout','approve_cash_payout','decline_cash_payout','reverse_cash_payout','log_purchase_from_drawer','record_supplier_payment_from_drawer') and p.prosecdef and p.proconfig is not null) as payout_functions,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'create_catering_order' and p.pronargs = 12 and p.prosecdef and p.proconfig is not null) as catering_new_function,
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute')) from pg_proc p where p.pronamespace='public'::regnamespace
     and p.proname in ('set_drawer_payout_limit','record_cash_payout','approve_cash_payout','decline_cash_payout','reverse_cash_payout','log_purchase_from_drawer','record_supplier_payment_from_drawer','cash_drawers_pending_guard','cash_payout_follow_reversal')
     or (p.proname = 'create_catering_order' and p.pronargs = 12)) as not_open_to_visitors,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='cash_drawers' and column_name='payouts_kobo') as payouts_column;
