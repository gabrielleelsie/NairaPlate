-- Read-only check for 20261105_late_entry_cost_at.sql. Changes nothing.
-- Expected single row:  true, true, true, false, 6, 5, false, false, false, true, true, true
select
  to_regprocedure('public.recipe_plate_cost_at(uuid,text,timestamptz)') is not null                         as cost_at_exists,
  to_regprocedure('public.late_entry_cost_preview(uuid)') is not null                                        as preview_exists,
  to_regprocedure('public.approve_and_post_late_entry(uuid,text,text,text,text)') is not null                as new_approve_exists,
  to_regprocedure('public.approve_and_post_late_entry(uuid,text,text)') is not null                          as old_approve_still_there,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='order_items'
     and column_name in ('cost_basis','cost_estimated_at','cost_estimated_by','cost_estimation_reason',
                         'cost_unavailable_reason','cost_unresolved_ingredients'))                            as order_item_cols,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='late_entries'
     and column_name in ('cost_decision','cost_decided_at','cost_decided_by','cost_estimate_reason',
                         'cost_unresolved_ingredients'))                                                     as late_entry_cols,
  has_function_privilege('anon', 'public.approve_and_post_late_entry(uuid,text,text,text,text)', 'execute')  as visitor_can_approve,
  has_function_privilege('anon', 'public.late_entry_cost_preview(uuid)', 'execute')                          as visitor_can_preview,
  has_function_privilege('authenticated', 'public.recipe_plate_cost_at(uuid,text,timestamptz)', 'execute')   as app_can_call_cost_at,
  has_function_privilege('authenticated', 'public.approve_and_post_late_entry(uuid,text,text,text,text)', 'execute') as staff_can_call_approve,
  (select prosrc like '%app.late_cost%' from pg_proc where oid = 'public.stamp_recipe_version()'::regprocedure) as line_rule_updated,
  (select prosrc like '%cost_basis%' from pg_proc where oid = 'public.order_items_lock_cost()'::regprocedure)  as cost_lock_updated;
