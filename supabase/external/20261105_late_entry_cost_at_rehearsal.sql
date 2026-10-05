-- Rehearsal for 20261105_late_entry_cost_at.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER the migration. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
-- Test sales are dated in 2019, so they use only test prices added by this rehearsal (also undone).
do $rehearsal$
declare
  biz     constant text := 'demo-kitchen';
  t_hist  constant timestamptz := '2019-12-01 09:00+01';
  t_back  constant timestamptz := '2019-12-15 09:00+01';
  s_exact constant timestamptz := '2019-12-10 13:00+01';
  s_back  constant timestamptz := '2019-12-20 13:00+01';
  s_miss  constant timestamptz := '2019-11-01 13:00+01';
  owner uuid; other_owner uuid; rec record; v_ver uuid; v_track text; first_ing uuid;
  today numeric; c numeric; n int; n2 int;
  e_exact uuid; e_back uuid; e_miss uuid; e_forge uuid; o1 uuid; o2 uuid; o_till uuid; r jsonb;
  ok boolean; res text := ''; fails int := 0; msg text;

  -- a submitted paper entry with one line of the test dish, inserted directly (as the app's submit would)
  function_unused int;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if to_regprocedure('public.late_entry_cost_preview(uuid)') is null then raise exception 'Run 20261105_late_entry_cost_at.sql first. Nothing was done.'; end if;
  if not public.business_has_access(biz) then raise exception 'Demo Kitchen''s plan has ended, so approval cannot be tested. Nothing was done.'; end if;

  select su.id into owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id = biz and su.role = 'owner' order by su.created_at limit 1;
  if owner is null then raise exception 'No Demo Kitchen owner sign-in found. Nothing was done.'; end if;
  select su.id into other_owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id <> biz and su.role in ('owner','supa_admin') limit 1;

  -- the test dish: a current Demo Kitchen recipe that has a cost today
  select r0.* into rec from public.recipes r0
   where r0.business_id = biz and r0.is_current and public.recipe_plate_cost_kobo(r0.id, biz) is not null
   order by r0.name limit 1;
  if rec.id is null then raise exception 'Demo Kitchen has no costed dish to test with. Nothing was done.'; end if;
  v_ver := rec.id; v_track := coalesce(rec.cost_grade, 'current');
  today := public.recipe_plate_cost_kobo(v_ver, biz);

  -- test prices in 2019 equal to today's prices, so the sale-time cost must equal today's cost (independent check)
  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind)
  select biz, i.id, v_track, case when v_track = 'current' then null else v_track end,
         coalesce(case when v_track <> 'current' then (select g.cost_kobo from public.ingredient_grade_prices g where g.ingredient_id = i.id and g.grade = v_track) end,
                  i.current_cost_kobo),
         t_hist, 'price_change', gen_random_uuid(), 'REHEARSAL', 'staff'
    from public.ingredients i where i.id in (select ingredient_id from public.recipe_items where recipe_id = v_ver);
  select ri.ingredient_id into first_ing from public.recipe_items ri join public.ingredients i on i.id = ri.ingredient_id
   where ri.recipe_id = v_ver order by i.name limit 1;
  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind, is_backfilled, backfill_basis)
  select biz, h.ingredient_id, h.price_track, h.grade, h.cost_per_base_unit_kobo, t_back,
         'migration_baseline', gen_random_uuid(), 'REHEARSAL', 'migration', true, 'rehearsal'
    from public.ingredient_price_history h where h.ingredient_id = first_ing and h.price_track = v_track and h.effective_from = t_hist;

  -- three paper entries: exact, backfilled, missing history
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status)
  values (biz, gen_random_uuid(), 'ZZ-REH-EXACT', s_exact, 1, 'rehearsal', owner, 'cash', rec.selling_price_kobo, 0, rec.selling_price_kobo, 'submitted')
  returning id into e_exact;
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status)
  values (biz, gen_random_uuid(), 'ZZ-REH-BACK', s_back, 1, 'rehearsal', owner, 'cash', rec.selling_price_kobo, 0, rec.selling_price_kobo, 'submitted')
  returning id into e_back;
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status)
  values (biz, gen_random_uuid(), 'ZZ-REH-MISS', s_miss, 1, 'rehearsal', owner, 'cash', rec.selling_price_kobo, 0, rec.selling_price_kobo, 'submitted')
  returning id into e_miss;
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status)
  values (biz, gen_random_uuid(), 'ZZ-REH-FORGE', s_exact, 1, 'rehearsal', owner, 'cash', rec.selling_price_kobo, 0, rec.selling_price_kobo, 'submitted')
  returning id into e_forge;
  insert into public.late_entry_items (late_entry_id, business_id, recipe_id, dish_name, quantity, unit_price_kobo, line_total_kobo)
  select x, biz, v_ver, rec.name, 1, rec.selling_price_kobo, rec.selling_price_kobo from unnest(array[e_exact, e_back, e_miss, e_forge]) x;

  -- act as the Demo Kitchen owner
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- T1 preview, full history at the sale time
  set local role authenticated;
  r := public.late_entry_cost_preview(e_exact);
  reset role;
  ok := r ->> 'overall_status' = 'sale_time_exact' and (r ->> 'is_complete')::boolean;
  res := res || E'\nT1 preview with full history -> costed at sale time: ' || case when ok then 'PASS' else 'FAIL ' || coalesce(r ->> 'overall_status', '?') end; fails := fails + (not ok)::int;

  -- T2 approve -> line costed at sale time, equal to the independent figure
  set local role authenticated;
  r := public.approve_and_post_late_entry(e_exact, 'closed_shift_included', null, null, null);
  reset role;
  o1 := (r ->> 'order_id')::uuid;
  select oi.cost_per_plate_kobo into c from public.order_items oi where oi.order_id = o1;
  ok := r ->> 'cost_decision' = 'historical'
    and (select cost_basis from public.order_items where order_id = o1) = 'sale_time_exact'
    and round(c, 4) = round(today, 4);
  res := res || E'\nT2 approve -> line frozen at sale-time cost (sale_time_exact): ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T3 backfilled history -> sale_time_backfilled
  set local role authenticated;
  r := public.approve_and_post_late_entry(e_back, 'closed_shift_included', null, null, null);
  reset role;
  ok := (select cost_basis from public.order_items where order_id = (r ->> 'order_id')::uuid) = 'sale_time_backfilled';
  res := res || E'\nT3 reconstructed history -> sale_time_backfilled: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T4 missing history -> preview unknown with names; approval without an estimate decision refused; nothing posted
  set local role authenticated;
  r := public.late_entry_cost_preview(e_miss);
  begin
    perform public.approve_and_post_late_entry(e_miss, 'closed_shift_included', null, null, null); ok := false;
  exception when others then ok := sqlerrm like 'Food cost unknown at the sale time%'; end;
  reset role;
  ok := ok and r ->> 'overall_status' = 'unknown_held'
    and jsonb_array_length(r -> 'lines' -> 0 -> 'cost' -> 'unresolved_ingredients') > 0
    and (select status from public.late_entries where id = e_miss) = 'submitted'
    and (select posted_order_id from public.late_entries where id = e_miss) is null;
  res := res || E'\nT4 missing history -> unknown, approval refused without estimate: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T5 estimate with a too-short reason is refused
  set local role authenticated;
  begin perform public.approve_and_post_late_entry(e_miss, 'closed_shift_included', null, 'estimate_current_price', 'oil'); ok := false;
  exception when others then ok := sqlerrm like 'Give a reason%'; end;
  reset role;
  res := res || E'\nT5 estimate without a proper reason refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T6 explicit estimate -> today's cost frozen with full evidence + audit entry
  set local role authenticated;
  r := public.approve_and_post_late_entry(e_miss, 'closed_shift_included', null, 'estimate_current_price', 'No price records for 2019');
  reset role;
  o2 := (r ->> 'order_id')::uuid;
  ok := exists (select 1 from public.order_items oi where oi.order_id = o2 and oi.cost_basis = 'estimated_current_price'
                  and round(oi.cost_per_plate_kobo, 4) = round(today, 4) and oi.cost_estimated_by = owner
                  and oi.cost_estimation_reason = 'No price records for 2019' and jsonb_array_length(oi.cost_unresolved_ingredients) > 0
                  and oi.cost_unavailable_reason is not null)
    and exists (select 1 from public.late_entries le where le.id = e_miss and le.cost_decision = 'estimate_current_price' and le.cost_decided_by = owner)
    and exists (select 1 from public.audit_logs a where a.action = 'late_entry_cost_estimated' and a.entity_id = e_miss);
  res := res || E'\nT6 owner estimate -> today''s cost saved with reason, who, when, missing list, audit: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T7 a cashier cannot preview or approve
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'cashier', 'staff_id', owner))::text, true);
  set local role authenticated;
  n := 0;
  begin perform public.late_entry_cost_preview(e_forge); exception when others then n := n + 1; end;
  begin perform public.approve_and_post_late_entry(e_forge, 'closed_shift_included', null, 'estimate_current_price', 'cashier try'); exception when others then n := n + 1; end;
  reset role;
  ok := n = 2;
  res := res || E'\nT7 cashier cannot preview or approve: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);

  -- T8 a forged paper-sale line (flag set by hand, no owner decision, cost supplied) is refused
  perform set_config('app.payment_internal', '1', true);
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo,
                             transfer_amount_kobo, created_by, client_sale_id, is_late_entry, actual_sold_at, paper_reference)
  select biz, 'walk_in', 'standard', total_kobo, total_kobo, 'paid', 'cash', total_kobo, 0, owner, client_sale_id, true, actual_sold_at, paper_reference
    from public.late_entries where id = e_forge returning id into o_till;
  perform set_config('app.payment_internal', '', true);
  perform set_config('app.late_cost', o_till::text, true);
  begin
    insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo, cost_per_plate_kobo, cost_basis)
    values (biz, o_till, v_ver, 1, rec.selling_price_kobo, 1, 'sale_time_exact');
    ok := false;
  exception when others then ok := sqlerrm like 'Paper-sale lines need an owner cost decision%'; end;
  perform set_config('app.late_cost', '', true);
  begin
    insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo, cost_per_plate_kobo)
    values (biz, o_till, v_ver, 1, rec.selling_price_kobo, 1);
    ok := false;
  exception when others then ok := ok and sqlerrm like 'Paper-sale lines can only be created by owner approval%'; end;
  res := res || E'\nT8 forged paper-sale line / hand-set flag refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T9 a normal Till line that supplies its own cost is overwritten by the server
  perform set_config('app.payment_internal', '1', true);
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo,
                             transfer_amount_kobo, created_by, client_sale_id)
  values (biz, 'walk_in', 'standard', rec.selling_price_kobo, rec.selling_price_kobo, 'paid', 'cash', rec.selling_price_kobo, 0, owner, gen_random_uuid())
  returning id into o_till;
  perform set_config('app.payment_internal', '', true);
  insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo, cost_per_plate_kobo, cost_basis)
  values (biz, o_till, v_ver, 1, rec.selling_price_kobo, 1, 'sale_time_exact');
  ok := exists (select 1 from public.order_items where order_id = o_till and cost_basis is null and round(cost_per_plate_kobo, 4) = round(today, 4));
  res := res || E'\nT9 Till line with a supplied cost -> server cost used, no label: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T10 retrying an approval returns the original order; no duplicate lines
  select count(*) into n from public.order_items where order_id = o1;
  set local role authenticated;
  r := public.approve_and_post_late_entry(e_exact, 'closed_shift_included', null, 'estimate_current_price', 'retry attempt');
  reset role;
  select count(*) into n2 from public.order_items where order_id = o1;
  ok := (r ->> 'already_posted')::boolean and (r ->> 'order_id')::uuid = o1 and n = n2
    and (select cost_basis from public.order_items where order_id = o1) = 'sale_time_exact';
  res := res || E'\nT10 approval retry -> same order, same frozen cost, no duplicate: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T11 a later price entry does not change a posted sale; the owner cannot edit the cost
  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind)
  select biz, h.ingredient_id, h.price_track, h.grade, h.cost_per_base_unit_kobo * 3, s_exact - interval '1 hour',
         'price_change', gen_random_uuid(), 'REHEARSAL', 'staff'
    from public.ingredient_price_history h where h.ingredient_id = first_ing and h.price_track = v_track and h.effective_from = t_hist;
  ok := round((select cost_per_plate_kobo from public.order_items where order_id = o1), 4) = round(c, 4);
  begin update public.order_items set cost_per_plate_kobo = 1 where order_id = o1; ok := false;
  exception when others then ok := ok and sqlerrm like 'The cost of a sold item cannot be changed%'; end;
  res := res || E'\nT11 new price entry leaves posted cost unchanged; edits refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T12 another business cannot preview or approve this entry
  if other_owner is null then
    res := res || E'\nT12 another business refused: SKIPPED (no other business owner)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', other_owner, 'role', 'authenticated',
      'app_metadata', json_build_object('business_id', (select business_id from public.staff_users where id = other_owner), 'role', 'owner', 'staff_id', other_owner))::text, true);
    set local role authenticated;
    n := 0;
    begin perform public.late_entry_cost_preview(e_forge); exception when others then n := n + 1; end;
    begin perform public.approve_and_post_late_entry(e_forge, 'closed_shift_included', null, 'estimate_current_price', 'other business'); exception when others then n := n + 1; end;
    reset role;
    ok := n = 2 and (select status from public.late_entries where id = e_forge) = 'submitted';
    res := res || E'\nT12 another business cannot preview or approve: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
    perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
      'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  end if;

  -- T13 the app cannot call the internal costing function
  set local role authenticated;
  begin perform public.recipe_plate_cost_at(v_ver, biz, now()); ok := false; exception when insufficient_privilege then ok := true; end;
  reset role;
  res := res || E'\nT13 app cannot call the internal costing function: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
