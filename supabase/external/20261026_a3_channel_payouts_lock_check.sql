-- Read-only. Expect: write_policies 0, read_policies 1, delete_policies 0, triggers 2, writer_still_definer true.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='channel_payouts' and cmd in ('INSERT','UPDATE')) as write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='channel_payouts' and cmd = 'SELECT') as read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='channel_payouts' and cmd = 'DELETE') as delete_policies,
  (select count(*) from pg_trigger where tgrelid='public.channel_payouts'::regclass and not tgisinternal and tgname in ('channel_payouts_no_direct_insert','channel_payouts_no_change')) as triggers,
  (select p.prosecdef from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='log_channel_payout') as writer_still_definer;
