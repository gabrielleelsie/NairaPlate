-- Read-only. Expect: 1, false (anon cannot run it), true (signed-in users can).
select
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='set_ingredient_price') as fn,
  has_function_privilege('anon', 'public.set_ingredient_price(uuid,bigint,text,text)', 'execute') as anon_can_run,
  has_function_privilege('authenticated', 'public.set_ingredient_price(uuid,bigint,text,text)', 'execute') as signed_in_can_run;
