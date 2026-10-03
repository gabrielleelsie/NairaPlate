-- NairaPlate system health check. READ-ONLY: it changes nothing. Safe to run any time in the Supabase SQL editor.
-- It returns ONE row. Expected values are in the comments. If any of the first eight columns is not as expected, send me the row.
-- The last three columns are for information (they are not faults by themselves).
select
  (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as tables_without_row_security,                           -- expect 0
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon') as visitor_table_privileges,   -- expect 0
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated'
     and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')) as risky_signed_in_privileges,                                              -- expect 0
  (select count(*) from pg_proc p join pg_trigger t on t.tgfoid=p.oid where p.pronamespace='public'::regnamespace
     and has_function_privilege('anon', p.oid, 'execute')) as trigger_functions_visitors_can_run,                                            -- expect 0
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proconfig is null) as privileged_functions_without_fixed_path, -- expect 0
  (select count(*) from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE')
     and tablename in ('audit_logs','order_adjustments','channel_payouts','price_decisions','batches','cash_drawers','cash_drawer_adjustments',
                       'purchases','supplier_transactions','credit_payments','customer_credits','catering_payments','stock_movements','orders','order_items')) as money_table_write_rules, -- expect 0
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace
     and c.relname in ('audit_logs','order_adjustments','channel_payouts','price_decisions','batches')) >= 8 as lock_triggers_present,     -- expect true
  (select count(*) from pg_proc where pronamespace='public'::regnamespace
     and proname in ('reverse_payout','reverse_price_decision','reverse_batch','reverse_purchase','reverse_supplier_payment',
                     'reverse_credit_entry','reverse_catering_payment','adjust_closed_drawer') and prosecdef and proconfig is not null) as reversal_functions_of_8, -- expect 8
  (select count(*) from public.cash_drawers where status='open') as shifts_open_now,                                                         -- information
  (select count(*) from public.ingredients where stock_base_qty < 0) as ingredients_below_zero_stock,                                        -- information: 0 is best; above 0 means a purchase was probably not logged
  (select count(*) from public.margin_flags where acknowledged = false) as unread_alerts;                                                    -- information
