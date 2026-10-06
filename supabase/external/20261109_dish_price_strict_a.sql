-- NairaPlate D9: a paper (late) sale is never priced from a price that started AFTER the sale.
-- Run once in the Supabase SQL editor of the LIVE project, AFTER 20261106_late_entry_fixes_a.sql. Safe to re-run.
-- Check afterwards: 20261109_dish_price_strict_a_check.sql.  Undo: 20261109_dish_price_strict_a_rollback.sql.
--
-- Problem. submit_late_entry priced each line with dish_price_at(), which, when no price had started yet at the sale time, returned the
--   dish's EARLIEST price (a later price) and, failing that, today's menu price and then the earliest price again. A paper sale from before
--   the first recorded price was therefore priced as if that price applied then.
-- Fix. A new lookup dish_price_strict(dish, time) returns only the price in force at that time, or nothing. submit_late_entry now uses it
--   and refuses the entry when there is no price, naming the dish and saying when its first recorded price starts (as information only).
-- Not changed: dish_price_at() and everything that uses it (the Till prices at today's price, which is correct for a live sale).
-- Not built (decided 5 October 2026, kept as a backlog item): an owner-approved "estimated selling price" for such a sale.
-- Method: submit_late_entry is read from the live database, the exact old text is replaced (it occurs twice, once per loop), and the
--   function is saved again. If the old text is not found, the script stops and changes nothing.

begin;

do $pre$
begin
  if to_regprocedure('public.dish_price_at(uuid,timestamptz)') is null
     or to_regprocedure('public.submit_late_entry(uuid,text,timestamptz,text,text,bigint,bigint,jsonb,text,text,text)') is null then
    raise exception 'A required function is missing. Nothing was changed.';
  end if;
end $pre$;

-- 1. The strict lookup. Accepts the dish identifier or any saved version's own identifier. Same access as dish_price_at (signed-in people only).
create or replace function public.dish_price_strict(p_dish uuid, p_at timestamptz)
returns table (id uuid, price_kobo bigint, effective_from timestamptz, source text)
language plpgsql stable set search_path to 'public' as $function$
declare v_dish uuid;
begin
  select coalesce(r.dish_id, r.id) into v_dish from public.recipes r where r.id = p_dish or r.dish_id = p_dish limit 1;
  if v_dish is null then v_dish := p_dish; end if;
  return query
    select dp.id, dp.price_kobo, dp.effective_from, dp.source
      from public.dish_prices dp
     where dp.dish_id = v_dish and dp.cancelled_at is null and dp.effective_from <= p_at
     order by dp.effective_from desc
     limit 1;
end $function$;
revoke all on function public.dish_price_strict(uuid, timestamptz) from public, anon;
grant execute on function public.dish_price_strict(uuid, timestamptz) to authenticated, service_role;

-- 2. Paper entries use it, with no fallback.
do $fix$
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
  if position(n1 in d) > 0 then
    raise notice 'Strict price rule already applied.';
  else
    if position(o1 in d) = 0 then raise exception 'submit_late_entry is not the expected version. Nothing was changed.'; end if;
    execute replace(d, o1, n1);
  end if;
end $fix$;

commit;
