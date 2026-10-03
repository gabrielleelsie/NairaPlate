-- Read-only. Expect: new_functions 2, method_column 1, method_rules 3, anon_can_run false, payments_without_method is information (payments made before methods existed).
select
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_supplier_payment_core','record_supplier_payment_v2')) as new_functions,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='supplier_transactions' and column_name='payment_method') as method_column,
  (select count(*) from pg_constraint where conrelid='public.supplier_transactions'::regclass and conname in ('supplier_transactions_method_rule','supplier_transactions_method_only_payment','supplier_transactions_other_needs_note')) as method_rules,
  (has_function_privilege('anon','public.record_supplier_payment_v2(uuid,bigint,text,text)','execute')
   or has_function_privilege('anon','public.record_supplier_payment_core(uuid,bigint,text,text)','execute')
   or has_function_privilege('anon','public.record_supplier_payment(uuid,bigint,text)','execute')
   or has_function_privilege('authenticated','public.record_supplier_payment_core(uuid,bigint,text,text)','execute')) as anon_can_run,
  (select count(*) from public.supplier_transactions where type='payment' and payment_method is null) as payments_without_method,
  (select count(*) from public.supplier_transactions where type='payment' and payment_method='legacy') as legacy_payments;
