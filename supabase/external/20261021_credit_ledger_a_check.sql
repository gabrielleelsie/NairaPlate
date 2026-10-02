-- Read-only. Expect: table 1, direct_write_policies 0, functions 4, new_columns 3, entries 1 (the one settled debt, carried over today),
-- debts_not_matching 0 (every debt's paid and written-off totals equal its entries), settled_flag_mismatch 0.
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='credit_payments') as table_exists,
  (select count(*) from pg_policies where schemaname='public' and tablename='credit_payments' and cmd <> 'SELECT') as direct_write_policies,
  (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('record_credit_payment','write_off_credit','reverse_credit_entry','create_manual_credit')) as functions,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='customer_credits' and column_name in ('paid_kobo','written_off_kobo','note')) as new_columns,
  (select count(*) from public.credit_payments) as entries,
  (select count(*) from public.customer_credits k
    where k.paid_kobo <> coalesce((select sum(p.amount_kobo) from public.credit_payments p left join public.credit_payments o on o.id = p.reverses_id
                                    where p.credit_id = k.id and (p.kind = 'payment' or (p.kind = 'reversal' and o.kind = 'payment'))), 0)
       or k.written_off_kobo <> coalesce((select sum(p.amount_kobo) from public.credit_payments p left join public.credit_payments o on o.id = p.reverses_id
                                    where p.credit_id = k.id and (p.kind = 'write_off' or (p.kind = 'reversal' and o.kind = 'write_off'))), 0)) as debts_not_matching,
  (select count(*) from public.customer_credits k where k.settled <> (k.amount_kobo - k.paid_kobo - k.written_off_kobo <= 0)) as settled_flag_mismatch;
