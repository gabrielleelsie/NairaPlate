-- Read-only. Expect: table 1, direct_write_policies 0, functions 3, orders_not_matching 0 (every order's totals equal its entries), entries equals the carried-over rows (4 today).
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='catering_payments') as table_exists,
  (select count(*) from pg_policies where schemaname='public' and tablename='catering_payments' and cmd <> 'SELECT') as direct_write_policies,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_catering_payment_v2','reverse_catering_payment','ledger_block_change')) as functions,
  (select count(*) from public.catering_deposits c
    where c.deposit_kobo <> coalesce((select sum(p.amount_kobo) from public.catering_payments p left join public.catering_payments o on o.id = p.reverses_id
                                       where p.order_id = c.id and (p.kind = 'deposit' or (p.kind = 'reversal' and o.kind = 'deposit'))), 0)
       or c.additional_payments_kobo <> coalesce((select sum(p.amount_kobo) from public.catering_payments p left join public.catering_payments o on o.id = p.reverses_id
                                       where p.order_id = c.id and (p.kind = 'payment' or (p.kind = 'reversal' and o.kind = 'payment'))), 0)) as orders_not_matching,
  (select count(*) from public.catering_payments) as entries;
