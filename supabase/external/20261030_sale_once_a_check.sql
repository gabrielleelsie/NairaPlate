-- Read-only. Expect: code_column 1, one_per_business_rule 1, new_functions 6, anon_can_run false, helpers_open_to_staff false, orders_with_code is information.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='client_sale_id') as code_column,
  (select count(*) from pg_indexes where schemaname='public' and indexname='orders_business_client_sale_uniq') as one_per_business_rule,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
     ('sale_once_existing','sale_once_stamp','create_cash_order_once','create_credit_order_once','create_transfer_order_once','find_sale_by_client_id')) as new_functions,
  (has_function_privilege('anon','public.create_cash_order_once(uuid,text,text,text,bigint,bigint,jsonb)','execute')
   or has_function_privilege('anon','public.create_credit_order_once(uuid,text,text,text,text,jsonb)','execute')
   or has_function_privilege('anon','public.create_transfer_order_once(uuid,text,text,jsonb)','execute')
   or has_function_privilege('anon','public.find_sale_by_client_id(uuid)','execute')) as anon_can_run,
  (has_function_privilege('authenticated','public.sale_once_existing(text,uuid)','execute')
   or has_function_privilege('authenticated','public.sale_once_stamp(text,uuid,uuid)','execute')) as helpers_open_to_staff,
  (select count(*) from public.orders where client_sale_id is not null) as orders_with_code;
