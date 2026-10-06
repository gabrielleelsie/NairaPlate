-- NairaPlate D4: an order line made from a paper (late) sale records the menu price row that applied at the SALE time.
-- Run once in the Supabase SQL editor of the LIVE project, AFTER 20261109_dish_price_strict_a.sql. Safe to re-run.
-- Check afterwards: 20261112_late_line_price_link_a_check.sql.  Undo: 20261112_late_line_price_link_a_rollback.sql.
--
-- Problem. The order line's unit price was always right (it is frozen on the paper entry), but its link to the price history
--   (order_items.dish_price_id) was filled in by a rule that looks up the price at the moment the line is written, that is at APPROVAL time.
--   If the dish's price changed between the sale and the approval, the line pointed at the wrong price row.
-- Fix. approve_and_post_late_entry now passes the entry line's own price row (already fixed at the sale time when the entry was sent, by the strict
--   lookup of 20261109) into the order line. The rule that fills a missing link is untouched, so Till sales are unchanged.
-- Data. No paper sale has been posted yet (0 late orders), so there is nothing to correct.
-- Method: approve_and_post_late_entry is read from the live database, the exact old text is replaced, and the function is saved again.
--   If the old text is not found, the script stops and changes nothing.

begin;

do $pre$
begin
  if to_regprocedure('public.approve_and_post_late_entry(uuid,text,text,text,text)') is null then
    raise exception 'approve_and_post_late_entry is missing. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'dish_price_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'late_entry_items' and column_name = 'dish_price_id') then
    raise exception 'dish_price_id is missing on order_items or late_entry_items. Nothing was changed.';
  end if;
end $pre$;

do $fix$
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
  if position(n1 in d) > 0 then
    raise notice 'Price link already applied.';
  else
    if position(o1 in d) = 0 then raise exception 'approve_and_post_late_entry is not the expected version. Nothing was changed.'; end if;
    execute replace(d, o1, n1);
  end if;
end $fix$;

commit;
