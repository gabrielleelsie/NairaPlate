-- Read-only. Expect: old_catering_function 0, new_catering_function 1, deposit_rule 1. deposits_without_method_not_carried_over is information: deposits saved by the old screen between part A and part B (they stay uncounted in expected cash).
select
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'create_catering_order' and p.pronargs = 11) as old_catering_function,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'create_catering_order' and p.pronargs = 12) as new_catering_function,
  (select count(*) from pg_constraint where conname = 'catering_payments_deposit_method_rule' and conrelid = 'public.catering_payments'::regclass) as deposit_rule,
  (select count(*) from public.catering_payments where kind = 'deposit' and not carried_over and method is null) as deposits_without_method_not_carried_over;
