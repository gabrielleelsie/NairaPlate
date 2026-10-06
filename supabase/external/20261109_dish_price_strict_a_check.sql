-- Read-only check for 20261109_dish_price_strict_a.sql. Changes nothing.
-- Expected single row:  true, false, true, true, true, true
select
  to_regprocedure('public.dish_price_strict(uuid,timestamptz)') is not null                                       as strict_lookup_exists,
  has_function_privilege('anon', 'public.dish_price_strict(uuid,timestamptz)', 'execute')                         as visitor_can_run_it,
  has_function_privilege('authenticated', 'public.dish_price_strict(uuid,timestamptz)', 'execute')                as signed_in_can_run_it,
  (select prosrc like '%dish_price_strict%' from pg_proc where oid = 'public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure) as paper_entries_use_strict,
  (select prosrc not like '%selling_price_kobo INTO v_unit_price%' and prosrc not like '%ORDER BY effective_from ASC%'
     from pg_proc where oid = 'public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure) as paper_entries_have_no_fallback,
  (select prosrc ilike '%dp.effective_from ASC%' from pg_proc where oid = 'public.dish_price_at(uuid,timestamptz)'::regprocedure) as till_lookup_untouched;
