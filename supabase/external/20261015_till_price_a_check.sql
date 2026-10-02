-- Read-only. Expect: cash_fn 1, anon_can_run false, credit_current true, transfer_current true.
select
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='create_cash_order') as cash_fn,
  has_function_privilege('anon','public.create_cash_order(text,text,text,bigint,bigint,jsonb)','execute') as anon_can_run,
  (select pg_get_functiondef(oid) like '%and is_current%' from pg_proc where pronamespace='public'::regnamespace and proname='create_credit_order') as credit_current,
  (select pg_get_functiondef(oid) like '%and is_current%' from pg_proc where pronamespace='public'::regnamespace and proname='create_transfer_order') as transfer_current;
