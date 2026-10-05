-- Rehearsal for 20261107_paper_rules_a.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER 20261105 and 20261106 and 20261107 have been applied. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
-- Note: the older rehearsal 20261105_late_entry_cost_at_rehearsal.sql approves entries that have no shift with "closed_shift_included".
-- After 20261107 that is refused on purpose (such entries need outside_shift_cash), so run that older rehearsal BEFORE 20261107, not after.
do $rehearsal$
declare
  biz     constant text := 'demo-kitchen';
  t_hist  constant timestamptz := '2019-12-01 09:00+01';
  s_time  constant timestamptz := '2019-12-10 13:00+01';
  owner uuid; other_owner uuid; rec record; v_ver uuid; v_track text;
  d_open uuid; d_closed uuid;
  e_out uuid; e_split uuid; e_xfer uuid; e_closed uuid; e_open uuid; e_wrong uuid;
  o_out uuid; o_split uuid; o_xfer uuid; o_closed uuid; o_open uuid; o_till uuid; r jsonb;
  half bigint; ok boolean; res text := ''; fails int := 0; n int; msg text;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if to_regprocedure('public.confirm_paper_transfer(uuid,text,text)') is null then raise exception 'Run 20261107_paper_rules_a.sql first. Nothing was done.'; end if;
  if not public.business_has_access(biz) then raise exception 'Demo Kitchen''s plan has ended, so approval cannot be tested. Nothing was done.'; end if;

  select su.id into owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id = biz and su.role = 'owner' order by su.created_at limit 1;
  if owner is null then raise exception 'No Demo Kitchen owner sign-in found. Nothing was done.'; end if;
  select su.id into other_owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id <> biz and su.role in ('owner','supa_admin') limit 1;
  select id into d_open from public.cash_drawers where business_id = biz and status = 'open' limit 1;
  select id into d_closed from public.cash_drawers where business_id = biz and status = 'closed' and closing_counted_kobo is not null order by closed_at desc limit 1;

  select r0.* into rec from public.recipes r0
   where r0.business_id = biz and r0.is_current and public.recipe_plate_cost_kobo(r0.id, biz) is not null and r0.selling_price_kobo > 1000
   order by r0.name limit 1;
  if rec.id is null then raise exception 'Demo Kitchen has no costed dish to test with. Nothing was done.'; end if;
  v_ver := rec.id; v_track := coalesce(rec.cost_grade, 'current'); half := rec.selling_price_kobo / 2;

  -- test ingredient prices dated 2019 so the paper sales can be costed (undone with everything else)
  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind)
  select biz, i.id, v_track, case when v_track = 'current' then null else v_track end,
         coalesce(case when v_track <> 'current' then (select g.cost_kobo from public.ingredient_grade_prices g where g.ingredient_id = i.id and g.grade = v_track) end,
                  i.current_cost_kobo),
         t_hist, 'price_change', gen_random_uuid(), 'REHEARSAL', 'staff'
    from public.ingredients i where i.id in (select ingredient_id from public.recipe_items where recipe_id = v_ver);

  -- paper entries: no shift (cash, split, transfer-only, and one wrong-choice test), a closed shift, an open shift
  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status, source_shift_id) values
    (biz, gen_random_uuid(), 'ZZ-REH-OUT',   s_time, 1, 'rehearsal', owner, 'cash',     rec.selling_price_kobo, 0, rec.selling_price_kobo, 'needs_shift_review', null),
    (biz, gen_random_uuid(), 'ZZ-REH-SPLIT', s_time, 1, 'rehearsal', owner, 'split',    half, rec.selling_price_kobo - half, rec.selling_price_kobo, 'needs_shift_review', null),
    (biz, gen_random_uuid(), 'ZZ-REH-XFER',  s_time, 1, 'rehearsal', owner, 'transfer', 0, rec.selling_price_kobo, rec.selling_price_kobo, 'needs_shift_review', null),
    (biz, gen_random_uuid(), 'ZZ-REH-WRONG', s_time, 1, 'rehearsal', owner, 'cash',     rec.selling_price_kobo, 0, rec.selling_price_kobo, 'needs_shift_review', null);
  select id into e_out   from public.late_entries where paper_reference = 'ZZ-REH-OUT'   and business_id = biz;
  select id into e_split from public.late_entries where paper_reference = 'ZZ-REH-SPLIT' and business_id = biz;
  select id into e_xfer  from public.late_entries where paper_reference = 'ZZ-REH-XFER'  and business_id = biz;
  select id into e_wrong from public.late_entries where paper_reference = 'ZZ-REH-WRONG' and business_id = biz;
  if d_closed is not null then
    insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                     payment_method, cash_kobo, transfer_kobo, total_kobo, status, source_shift_id)
    values (biz, gen_random_uuid(), 'ZZ-REH-CLOSED', s_time, 1, 'rehearsal', owner, 'cash', rec.selling_price_kobo, 0, rec.selling_price_kobo, 'needs_shift_review', d_closed)
    returning id into e_closed;
  end if;
  if d_open is not null then
    insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                     payment_method, cash_kobo, transfer_kobo, total_kobo, status, source_shift_id)
    values (biz, gen_random_uuid(), 'ZZ-REH-OPEN', s_time, 1, 'rehearsal', owner, 'split', half, rec.selling_price_kobo - half, rec.selling_price_kobo, 'submitted', d_open)
    returning id into e_open;
  end if;
  insert into public.late_entry_items (late_entry_id, business_id, recipe_id, dish_name, quantity, unit_price_kobo, line_total_kobo)
  select le.id, biz, v_ver, rec.name, 1, rec.selling_price_kobo, rec.selling_price_kobo
    from public.late_entries le where le.business_id = biz and le.paper_reference like 'ZZ-REH-%';

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- T1 / T2 / T3: an entry with no shift
  begin perform public.approve_and_post_late_entry(e_wrong, null, 'night sale, no shift open', null, null); ok := false;
  exception when others then ok := sqlerrm like 'This sale is outside any shift%'; end;
  res := res || E'\nT1 no shift, no choice made -> refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  begin perform public.approve_and_post_late_entry(e_wrong, 'closed_shift_included', 'night sale, no shift open', null, null); ok := false;
  exception when others then ok := sqlerrm like 'This sale is outside any shift%'; end;
  res := res || E'\nT2 no shift, a closed-shift choice -> refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  begin perform public.approve_and_post_late_entry(e_wrong, 'outside_shift_cash', 'abc', null, null); ok := false;
  exception when others then ok := sqlerrm like 'Type a reason%'; end;
  res := res || E'\nT3 outside_shift_cash without a proper reason -> refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T4 outside_shift_cash with a reason
  r := public.approve_and_post_late_entry(e_out, 'outside_shift_cash', 'Night sale, no shift was open', null, null);
  o_out := (r ->> 'order_id')::uuid;
  ok := (select shift_resolution from public.late_entries where id = e_out) = 'outside_shift_cash'
    and (select status from public.orders where id = o_out) = 'paid' and (select cash_amount_kobo from public.orders where id = o_out) = rec.selling_price_kobo;
  res := res || E'\nT4 no shift, outside_shift_cash with a reason -> posted and recorded as such: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T5 / T6 / T7: a closed shift
  if e_closed is null then
    res := res || E'\nT5-T7 closed-shift choices: SKIPPED (Demo Kitchen has no closed shift with a count)';
  else
    begin perform public.approve_and_post_late_entry(e_closed, null, 'cash was already counted', null, null); ok := false;
    exception when others then ok := sqlerrm like 'Closed-shift entries require%'; end;
    res := res || E'\nT5 closed shift, no choice made (even with a reason) -> refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
    begin perform public.approve_and_post_late_entry(e_closed, 'closed_shift_included', 'x', null, null); ok := false;
    exception when others then ok := sqlerrm like 'Type a reason%'; end;
    res := res || E'\nT6 closed shift, choice without a reason -> refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
    r := public.approve_and_post_late_entry(e_closed, 'closed_shift_included', 'Cash was already in the count at close', null, null);
    o_closed := (r ->> 'order_id')::uuid;
    ok := (select shift_resolution from public.late_entries where id = e_closed) = 'closed_shift_included'
      and (select notes from public.late_entries where id = e_closed) like 'Cash was already%';
    res := res || E'\nT7 closed shift, choice with a reason -> posted, choice and reason kept: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;

  -- T8 an open shift: posted straight to that shift
  if e_open is null then
    res := res || E'\nT8 open shift: SKIPPED (Demo Kitchen has no open shift right now)';
  else
    r := public.approve_and_post_late_entry(e_open);
    o_open := (r ->> 'order_id')::uuid;
    ok := (select shift_resolution from public.late_entries where id = e_open) = 'open_shift_direct'
      and (select status from public.orders where id = o_open) = 'awaiting_payment';
    res := res || E'\nT8 open shift, split sale -> posted to that shift, order awaiting payment: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;

  -- T9 split and transfer-only paper sales wait for the transfer
  r := public.approve_and_post_late_entry(e_split, 'outside_shift_cash', 'Split sale, no shift open', null, null); o_split := (r ->> 'order_id')::uuid;
  r := public.approve_and_post_late_entry(e_xfer,  'outside_shift_cash', 'Transfer sale, no shift open', null, null); o_xfer := (r ->> 'order_id')::uuid;
  ok := (select status from public.orders where id = o_split) = 'awaiting_payment' and (select cash_amount_kobo from public.orders where id = o_split) = half
    and (select status from public.orders where id = o_xfer) = 'awaiting_payment' and (select cash_amount_kobo from public.orders where id = o_xfer) = 0;
  res := res || E'\nT9 split and transfer-only paper sales -> awaiting payment, cash part kept on the order: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T10 nobody can mark it paid except through the confirm function
  begin update public.orders set status = 'paid' where id = o_split; ok := (select status from public.orders where id = o_split) = 'awaiting_payment';
  exception when others then ok := true; end;
  res := res || E'\nT10 a direct status change to paid does not work: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T11 cancel rules
  begin perform public.cancel_unpaid_order(o_split, 'customer left'); ok := false;
  exception when others then ok := sqlerrm like 'Cash was already taken for this paper sale%'; end;
  res := res || E'\nT11 a paper sale with cash taken cannot be cancelled as unpaid: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T12 a cashier cannot confirm; short proof and short reason are refused
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'cashier', 'staff_id', owner))::text, true);
  begin perform public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'Customer paid at 3pm'); ok := false;
  exception when others then ok := sqlerrm like 'Only a business owner%'; end;
  res := res || E'\nT12 a cashier cannot confirm a transfer: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  n := 0;
  begin perform public.confirm_paper_transfer(o_split, 'abc', 'Customer paid at 3pm'); exception when others then n := n + (sqlerrm like 'Type the bank reference%')::int; end;
  begin perform public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'abc'); exception when others then n := n + (sqlerrm like 'Type a reason%')::int; end;
  ok := n = 2 and (select status from public.orders where id = o_split) = 'awaiting_payment';
  res := res || E'\nT13 proof or reason under 5 characters -> refused, still awaiting payment: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T14 the owner confirms with proof and a reason
  r := public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'Customer paid at 3pm');
  ok := (select status from public.orders where id = o_split) = 'paid' and not (r ->> 'already_confirmed')::boolean
    and exists (select 1 from public.paper_transfer_confirmations c where c.order_id = o_split and c.proof_note = 'UBA ref 123456'
                  and c.reason = 'Customer paid at 3pm' and c.confirmed_by = owner and c.transfer_kobo = rec.selling_price_kobo - half)
    and exists (select 1 from public.audit_logs a where a.action = 'paper_transfer_confirmed' and a.entity_id = o_split);
  res := res || E'\nT14 owner confirms with proof and reason -> paid, record saved, audit line written: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T15 confirming again changes nothing
  r := public.confirm_paper_transfer(o_split, 'another ref 999', 'second try here');
  ok := (r ->> 'already_confirmed')::boolean and (select count(*) from public.paper_transfer_confirmations where order_id = o_split) = 1;
  res := res || E'\nT15 confirming twice -> same single record: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T16 only paper sales can be confirmed this way
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by, client_sale_id)
  select biz, 'walk_in', 'standard', 1000, 1000, 'paid', 'cash', 1000, 0, owner, gen_random_uuid() returning id into o_till;
  begin perform public.confirm_paper_transfer(o_till, 'UBA ref 123456', 'Not a paper sale'); ok := false;
  exception when others then ok := sqlerrm like 'Only a paper sale%'; end;
  res := res || E'\nT16 a normal sale cannot be confirmed here: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T17 confirmation records cannot be written or changed by the app
  n := 0;
  set local role authenticated;
  begin insert into public.paper_transfer_confirmations (business_id, order_id, proof_note, reason, transfer_kobo) values (biz, o_xfer, 'forged ref', 'forged reason', 1); exception when others then n := n + 1; end;
  begin update public.paper_transfer_confirmations set reason = 'edited reason'; exception when others then n := n + 1; end;
  begin delete from public.paper_transfer_confirmations; exception when others then n := n + 1; end;
  reset role;
  ok := n = 3;
  res := res || E'\nT17 app cannot insert, edit or delete a confirmation: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T18 a transfer-only paper sale with no cash CAN be cancelled as unpaid
  begin perform public.cancel_unpaid_order(o_xfer, 'customer never paid'); ok := (select status from public.orders where id = o_xfer) = 'cancelled';
  exception when others then ok := false; end;
  res := res || E'\nT18 transfer-only paper sale that never arrived -> can be cancelled: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T19 another business cannot confirm
  reset role;
  if other_owner is null then
    res := res || E'\nT19 another business refused: SKIPPED (no other business owner)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', other_owner, 'role', 'authenticated',
      'app_metadata', json_build_object('business_id', (select business_id from public.staff_users where id = other_owner), 'role', 'owner', 'staff_id', other_owner))::text, true);
    set local role authenticated;
    begin perform public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'other business try'); ok := false;
    exception when others then ok := sqlerrm like 'Order not found%'; end;
    reset role;
    res := res || E'\nT19 another business cannot confirm this sale: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;

  -- T20 a signed-out visitor cannot confirm
  set local role anon;
  begin perform public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'visitor try'); ok := false; exception when insufficient_privilege then ok := true; when others then ok := false; end;
  reset role;
  res := res || E'\nT20 signed-out visitor cannot confirm: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
