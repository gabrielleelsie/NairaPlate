-- Read-only. Expect: write_policies 0, read_policies 1, anon_can_run all false, signed_in_can_run all true.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='catering_deposits' and cmd in ('INSERT','UPDATE','DELETE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='catering_deposits' and cmd = 'SELECT') as read_policies,
  (has_function_privilege('anon','public.log_purchase(uuid,numeric,text,bigint,text,text,text,text,uuid)','execute')
   or has_function_privilege('anon','public.save_recipe_version(uuid,text,text,numeric,bigint,jsonb,text)','execute')
   or has_function_privilege('anon','public.trial_limits_apply(text)','execute')) as anon_can_run,
  (has_function_privilege('authenticated','public.log_purchase(uuid,numeric,text,bigint,text,text,text,text,uuid)','execute')
   and has_function_privilege('authenticated','public.save_recipe_version(uuid,text,text,numeric,bigint,jsonb,text)','execute')
   and has_function_privilege('authenticated','public.trial_limits_apply(text)','execute')) as signed_in_can_run;
