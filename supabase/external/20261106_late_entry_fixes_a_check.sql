-- Read-only check for 20261106_late_entry_fixes_a.sql. Changes nothing.
-- Expected single row:  false, true, true, true, true
select
  (select prosrc like '%150000%' from pg_proc where oid = 'public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure) as submit_still_invents_a_price,
  (select prosrc like '%No price is on record for%' from pg_proc where oid = 'public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure) as submit_refuses_no_price,
  (select prosrc like '%closed without a count, so there is no count to add late cash to%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as approve_checks_count,
  (select prosrc like '%recorded_by_name%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as approve_records_name,
  not has_function_privilege('anon', 'public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)', 'execute') as visitor_still_blocked;
