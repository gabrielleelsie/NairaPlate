-- Rehearsal for 20261112_late_line_price_link_a.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER 20261112 has been applied. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
do $rehearsal$
declare
  biz     constant text := 'demo-kitchen';
  t_hist  constant timestamptz := '2019-12-01 09:00+01';
  s_time  constant timestamptz := '2019-12-10 13:00+01';
  owner uuid; rec record; v_dish uuid; v_ver uuid; v_track text;
  p1 uuid; p1_price bigint; now_row uuid; e_id uuid; o_paper uuid; o_till uuid; r jsonb;
  ok boolean; res text := ''; fails int := 0; n int;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if not (select prosrc like '%it.unit_price_kobo, it.dish_price_id%' from pg_proc where oid = 'public.approve_and_post_late_entry(uuid,text,text,text,text)'::regprocedure) then
    raise exception 'Run 20261112_late_line_price_link_a.sql first. Nothing was done.';
  end if;
  if not public.business_has_access(biz) then raise exception 'Demo Kitchen''s plan has ended. Nothing was done.'; end if;

  select su.id into owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id = biz and su.role = 'owner' order by su.created_at limit 1;
  if owner is null then raise exception 'No Demo Kitchen owner sign-in found. Nothing was done.'; end if;
  select r0.* into rec from public.recipes r0
   where r0.business_id = biz and r0.is_current and public.recipe_plate_cost_kobo(r0.id, biz) is not null and r0.selling_price_kobo > 1000
     and exists (select 1 from public.dish_prices dp where dp.dish_id = coalesce(r0.dish_id, r0.id) and dp.cancelled_at is null and dp.effective_from <= now())
   order by r0.name limit 1;
  if rec.id is null then raise exception 'Demo Kitchen has no costed dish with a recorded price to test with. Nothing was done.'; end if;
  v_ver := rec.id; v_dish := coalesce(rec.dish_id, rec.id); v_track := coalesce(rec.cost_grade, 'current');

  -- a menu price that applied in 2019, different from today's price (undone with everything else)
  p1_price := rec.selling_price_kobo + 1111;
  insert into public.dish_prices (business_id, dish_id, price_kobo, effective_from, source) values (biz, v_dish, p1_price, t_hist, 'backfill') returning id into p1;
  select s.id into now_row from public.dish_price_at(v_dish, now()) s;

  -- ingredient prices dated 2019 so the paper sale can be costed
  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind)
  select biz, i.id, v_track, case when v_track = 'current' then null else v_track end,
         coalesce(case when v_track <> 'current' then (select g.cost_kobo from public.ingredient_grade_prices g where g.ingredient_id = i.id and g.grade = v_track) end,
                  i.current_cost_kobo),
         t_hist, 'price_change', gen_random_uuid(), 'REHEARSAL', 'staff'
    from public.ingredients i where i.id in (select ingredient_id from public.recipe_items where recipe_id = v_ver);

  -- a paper entry priced from the 2019 row, as the entry screen does at the sale time
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status, source_shift_id)
  values (biz, gen_random_uuid(), 'ZZ-REH-D4', s_time, 1, 'rehearsal', owner, 'cash', p1_price, 0, p1_price, 'needs_shift_review', null) returning id into e_id;
  insert into public.late_entry_items (late_entry_id, business_id, recipe_id, dish_name, quantity, dish_price_id, unit_price_kobo, line_total_kobo)
  values (e_id, biz, v_ver, rec.name, 1, p1, p1_price, p1_price);

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);
  r := public.approve_and_post_late_entry(e_id, 'outside_shift_cash', 'Rehearsal sale, no shift open', null, null);
  o_paper := (r ->> 'order_id')::uuid;

  -- T1 the order line links the price row of the SALE time, not today's
  if now_row = p1 then
    res := res || E'\nT1 paper line links the sale-time price row: SKIPPED (today''s price row is the same row)';
  else
    ok := (select oi.dish_price_id from public.order_items oi where oi.order_id = o_paper) = p1
      and (select oi.dish_price_id from public.order_items oi where oi.order_id = o_paper) is distinct from now_row;
    res := res || E'\nT1 paper line links the price row of the sale time, not today''s row: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;

  -- T2 the line's unit price equals the price of the row it links to
  ok := (select oi.unit_price_kobo from public.order_items oi where oi.order_id = o_paper) = p1_price
    and (select dp.price_kobo from public.dish_prices dp where dp.id = (select oi.dish_price_id from public.order_items oi where oi.order_id = o_paper)) = p1_price;
  res := res || E'\nT2 the line''s unit price equals the price of the row it links to: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T3 a normal Till line still gets today's price row from the existing rule
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by, client_sale_id)
  select biz, 'walk_in', 'standard', rec.selling_price_kobo, rec.selling_price_kobo, 'paid', 'cash', rec.selling_price_kobo, 0, owner, gen_random_uuid() returning id into o_till;
  insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo) values (biz, o_till, v_ver, 1, rec.selling_price_kobo);
  ok := (select oi.dish_price_id from public.order_items oi where oi.order_id = o_till) = now_row;
  res := res || E'\nT3 a normal Till line still links today''s price row: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T4 no paper line anywhere in Demo Kitchen links a different row from its entry line
  select count(*) into n from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.is_late_entry
    join public.late_entries e on e.business_id = o.business_id and e.client_sale_id = o.client_sale_id
    join public.late_entry_items i on i.late_entry_id = e.id and i.recipe_id = oi.recipe_id
   where o.business_id = biz and oi.dish_price_id is distinct from i.dish_price_id;
  ok := n = 0;
  res := res || E'\nT4 no paper line links a different price row from its entry line: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
