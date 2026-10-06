-- Read-only. Expect: visitors_can_run false, signed_in_can_run false, trigger_still_in_place true, trigger_functions_visitors_can_run 0
select
  has_function_privilege('anon', 'public.receipts_guard()', 'execute') as visitors_can_run,
  has_function_privilege('authenticated', 'public.receipts_guard()', 'execute') as signed_in_can_run,
  exists (select 1 from pg_trigger where tgname = 'receipts_guard_trg' and tgenabled = 'O') as trigger_still_in_place,
  (select count(*) from pg_proc p join pg_trigger t on t.tgfoid = p.oid
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')) as trigger_functions_visitors_can_run;
