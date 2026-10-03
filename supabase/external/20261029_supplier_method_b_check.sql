-- Read-only. Expect: old_function 0, v2_function 1, drawer_function 1.
select
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='record_supplier_payment' and pronargs=3) as old_function,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='record_supplier_payment_v2') as v2_function,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='record_supplier_payment_from_drawer') as drawer_function;
