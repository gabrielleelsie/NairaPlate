-- Read-only. Expect: features_table 1, order_items_table 1, new_columns 6, functions 3, anon_can_create false, businesses_switched_on = businesses with bookings.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='business_features') as features_table,
  (select count(*) from information_schema.tables where table_schema='public' and table_name='catering_order_items') as order_items_table,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='catering_deposits' and column_name in ('status','delivery_address','notes','delivery_fee_kobo','discount_kobo','subtotal_kobo')) as new_columns,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('create_catering_order','set_catering_status','catering_enabled')) as functions,
  has_function_privilege('anon','public.create_catering_order(text,text,date,time,text,text,jsonb,bigint,bigint,bigint,text)','execute') as anon_can_create,
  (select count(*) from public.business_features where feature='catering' and enabled) as businesses_switched_on,
  (select count(distinct business_id) from public.catering_deposits) as businesses_with_bookings;
