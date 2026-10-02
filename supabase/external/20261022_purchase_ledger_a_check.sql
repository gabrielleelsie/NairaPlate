-- Read-only. Expect: new_columns 7, purchase_triggers 2, functions 2, supplier_type_allows_reversal 1, direct_write_policies_still_there 2 (closed in part B), reversals 0.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='purchases' and column_name in ('kind','reverses_id','reason','recorded_by_name','base_qty','price_set_at','before_state')) as new_columns,
  (select count(*) from pg_trigger where tgrelid='public.purchases'::regclass and not tgisinternal and tgname in ('purchases_no_change','purchases_check')) as purchase_triggers,
  (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and ((p.proname='reverse_purchase') or (p.proname='log_purchase' and pg_get_functiondef(p.oid) like '%before_state%'))) as functions,
  (select count(*) from pg_constraint where conrelid='public.supplier_transactions'::regclass and conname='supplier_transactions_type_check' and pg_get_constraintdef(oid) like '%purchase_reversal%') as supplier_type_allows_reversal,
  (select count(*) from pg_policies where schemaname='public' and tablename='purchases' and cmd in ('INSERT','UPDATE')) as direct_write_policies_still_there,
  (select count(*) from public.purchases where kind='reversal') as reversals;
