-- Read-only. Expect: visitor_table_privileges 0, risky_signed_in_privileges 0, trigger_functions_visitors_can_run 0, late_tables_select_only true, view_closed_to_visitors true.
select
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon') as visitor_table_privileges,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')) as risky_signed_in_privileges,
  (select count(*) from pg_proc p join pg_trigger t on t.tgfoid=p.oid where p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')) as trigger_functions_visitors_can_run,
  (has_table_privilege('authenticated','public.late_entries','select') and not has_table_privilege('authenticated','public.late_entries','insert')
   and not has_table_privilege('authenticated','public.late_entry_items','insert') and not has_table_privilege('authenticated','public.late_entries','update')) as late_tables_select_only,
  not has_table_privilege('anon','public.dish_price_periods','select') as view_closed_to_visitors;
