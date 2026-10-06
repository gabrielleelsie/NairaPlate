-- Undo 20261112_late_line_price_link_a.sql (brings back the approval-time lookup for paper lines; not recommended).
begin;
do $undo$
declare
  d text;
  o1 constant text := $o1$    insert into public.order_items (
      business_id, order_id, recipe_id, quantity, unit_price_kobo
    ) values (
      v_biz, v_order_id, it.recipe_id, it.quantity, it.unit_price_kobo
    );$o1$;
  n1 constant text := $n1$    insert into public.order_items (
      business_id, order_id, recipe_id, quantity, unit_price_kobo, dish_price_id
    ) values (
      v_biz, v_order_id, it.recipe_id, it.quantity, it.unit_price_kobo, it.dish_price_id
    );$n1$;
begin
  d := pg_get_functiondef('public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure);
  if position(n1 in d) > 0 then execute replace(d, n1, o1); end if;
end $undo$;
commit;
