-- Read-only. Expect: write_policies 0, read_policies 1, delete_policies 0, triggers 2, adjust_order_still_definer true.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='order_adjustments' and cmd in ('INSERT','UPDATE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='order_adjustments' and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='order_adjustments' and cmd = 'DELETE') as delete_policies,
  (select count(*) from pg_trigger where tgrelid='public.order_adjustments'::regclass and not tgisinternal and tgname in ('order_adjustments_no_direct_insert','order_adjustments_no_change')) as triggers,
  (select p.prosecdef from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='adjust_order') as adjust_order_still_definer;
