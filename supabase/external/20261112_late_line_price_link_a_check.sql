-- Read-only check for 20261112_late_line_price_link_a.sql. Changes nothing.
-- Expected single row:  true, true, 0
select
  (select prosrc like '%unit_price_kobo, dish_price_id%' and prosrc like '%it.unit_price_kobo, it.dish_price_id%'
     from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) as paper_lines_link_the_sale_time_price,
  (select prosrc like '%coalesce(NEW.created_at, now())%' from pg_proc where oid = 'public.order_items_set_dish_price()'::regprocedure) as till_rule_untouched,
  (select count(*) from public.order_items oi
     join public.orders o on o.id = oi.order_id and o.is_late_entry
     join public.late_entries e on e.business_id = o.business_id and e.client_sale_id = o.client_sale_id
     join public.late_entry_items i on i.late_entry_id = e.id and i.recipe_id = oi.recipe_id
    where oi.dish_price_id is distinct from i.dish_price_id) as paper_lines_with_the_wrong_price_row;
