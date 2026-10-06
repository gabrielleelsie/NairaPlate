-- Read-only. Expect: visitors_can_run false, signed_in_can_run false, server_can_run true
select
  has_function_privilege('anon', 'public.resolve_late_entry_recipe(text,text)', 'execute') as visitors_can_run,
  has_function_privilege('authenticated', 'public.resolve_late_entry_recipe(text,text)', 'execute') as signed_in_can_run,
  has_function_privilege('service_role', 'public.resolve_late_entry_recipe(text,text)', 'execute') as server_can_run;
