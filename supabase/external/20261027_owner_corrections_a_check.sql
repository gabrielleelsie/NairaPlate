-- Read-only. Expect: kind_columns 3, one_reversal_indexes 3, correction_functions 3, functions_not_open_to_visitors true, decision_allows_reversal true, batch_trigger_aware true.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name in ('channel_payouts','price_decisions','batches') and column_name = 'kind') as kind_columns,
  (select count(*) from pg_indexes where schemaname='public' and indexname in ('channel_payouts_one_reversal','price_decisions_one_reversal','batches_one_reversal')) as one_reversal_indexes,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reverse_payout','reverse_price_decision','reverse_batch') and p.prosecdef and p.proconfig is not null) as correction_functions,
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reverse_payout','reverse_price_decision','reverse_batch')) as functions_not_open_to_visitors,
  (select pg_get_constraintdef(oid) like '%reversal%' from pg_constraint where conname = 'price_decisions_decision_check' and conrelid = 'public.price_decisions'::regclass) as decision_allows_reversal,
  (select pg_get_functiondef(p.oid) like '%NEW.kind = ''reversal''%' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'check_batch_stock_mode') as batch_trigger_aware;
