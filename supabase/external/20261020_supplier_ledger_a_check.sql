-- Read-only. Expect: new_columns 3, functions 3 (record, reverse, balance helper), frozen_trigger 1, reversal_trigger 1, anon_can_run false, existing_entries 2 (today).
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='supplier_transactions' and column_name in ('reverses_id','reason','recorded_by_name')) as new_columns,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_supplier_payment','reverse_supplier_payment','supplier_balance_kobo')) as functions,
  (select count(*) from pg_trigger where tgrelid='public.supplier_transactions'::regclass and tgname='supplier_transactions_no_change') as frozen_trigger,
  (select count(*) from pg_trigger where tgrelid='public.supplier_transactions'::regclass and tgname='supplier_transactions_check_reversal') as reversal_trigger,
  (has_function_privilege('anon','public.record_supplier_payment(uuid,bigint,text)','execute') or has_function_privilege('anon','public.reverse_supplier_payment(uuid,text)','execute')) as anon_can_run,
  (select count(*) from public.supplier_transactions) as existing_entries;
