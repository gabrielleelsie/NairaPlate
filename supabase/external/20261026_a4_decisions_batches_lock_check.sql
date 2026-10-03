-- Read-only. Expect: decision_write_policies 0, decision_read_policies 1, batch_write_policies 0, batch_read_policies 1, triggers 4, batch_fix_applied true.
-- batch_fix_applied is true when batches no longer use the shared version-stamping function (see 20261025_batch_trigger_fix.sql).
select
  (select count(*) from pg_policies where schemaname='public' and tablename='price_decisions' and cmd in ('INSERT','UPDATE','DELETE')) as decision_write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='price_decisions' and cmd = 'SELECT') as decision_read_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='batches' and cmd in ('INSERT','UPDATE','DELETE')) as batch_write_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='batches' and cmd = 'SELECT') as batch_read_policies,
  (select count(*) from pg_trigger where not tgisinternal and tgname in ('price_decisions_no_direct_insert','price_decisions_protect','batches_no_direct_insert','batches_no_change')) as triggers,
  (select p.proname = 'stamp_batch_version' from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.batches'::regclass and t.tgname = 'batches_stamp_version') as batch_fix_applied;
