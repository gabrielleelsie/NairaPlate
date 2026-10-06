-- Undo 20261109_dish_price_strict_a.sql. This brings back the earliest-price fallback for paper entries (not recommended).
begin;
do $undo$
declare
  d text;
  o1 constant text := $o1$    SELECT id, price_kobo INTO v_price_id, v_unit_price
      FROM public.dish_price_at(v_dish_id, p_actual_sold_at)
     LIMIT 1;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      SELECT selling_price_kobo INTO v_unit_price
        FROM public.recipes
       WHERE id = v_dish_uuid;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      SELECT price_kobo INTO v_unit_price
        FROM public.dish_prices
       WHERE dish_id = v_dish_id AND cancelled_at IS NULL
       ORDER BY effective_from ASC
       LIMIT 1;
    END IF;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN RAISE EXCEPTION 'No price is on record for "%" at the time of this sale. Ask the owner to set a price first.', v_dish_name; END IF;$o1$;
  n1 constant text := $n1$    SELECT id, price_kobo INTO v_price_id, v_unit_price
      FROM public.dish_price_strict(v_dish_id, p_actual_sold_at)
     LIMIT 1;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'No menu price was on record for "%" at the time of this sale. %. A later price, or today''s price, is never used for an earlier sale.', v_dish_name,
        coalesce((SELECT 'Its first recorded price starts on ' || to_char(min(dp.effective_from) AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' (Nigeria time)'
                    FROM public.dish_prices dp WHERE dp.dish_id = v_dish_id AND dp.cancelled_at IS NULL),
                 'No price has been recorded for this dish yet');
    END IF;$n1$;
begin
  d := pg_get_functiondef('public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)'::regprocedure);
  if position(n1 in d) > 0 then execute replace(d, n1, o1); end if;
end $undo$;
drop function if exists public.dish_price_strict(uuid, timestamptz);
commit;
