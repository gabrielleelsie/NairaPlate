-- Rehearsal for 20261110_transfer_lost_a.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER 20261107 and 20261110 have been applied. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
do $rehearsal$
declare
  biz     constant text := 'demo-kitchen';
  t_hist  constant timestamptz := '2019-12-01 09:00+01';
  s_time  constant timestamptz := '2019-12-10 13:00+01';
  owner uuid; other_owner uuid; rec record; v_ver uuid; v_track text;
  e_split uuid; e_xfer uuid; o_split uuid; o_xfer uuid; o_till uuid; r jsonb;
  half bigint; ok boolean; res text := ''; fails int := 0; n int;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if to_regprocedure('public.mark_paper_transfer_lost(uuid,text)') is null then raise exception 'Run 20261110_transfer_lost_a.sql first. Nothing was done.'; end if;
  if not public.business_has_access(biz) then raise exception 'Demo Kitchen''s plan has ended. Nothing was done.'; end if;

  select su.id into owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id = biz and su.role = 'owner' order by su.created_at limit 1;
  if owner is null then raise exception 'No Demo Kitchen owner sign-in found. Nothing was done.'; end if;
  select su.id into other_owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id <> biz and su.role in ('owner','supa_admin') limit 1;

  select r0.* into rec from public.recipes r0
   where r0.business_id = biz and r0.is_current and public.recipe_plate_cost_kobo(r0.id, biz) is not null and r0.selling_price_kobo > 1000
   order by r0.name limit 1;
  if rec.id is null then raise exception 'Demo Kitchen has no costed dish to test with. Nothing was done.'; end if;
  v_ver := rec.id; v_track := coalesce(rec.cost_grade, 'current'); half := rec.selling_price_kobo / 2;

  insert into public.ingredient_price_history (business_id, ingredient_id, price_track, grade, cost_per_base_unit_kobo, effective_from,
                                               source_type, source_id, source_reference, recorded_by_kind)
  select biz, i.id, v_track, case when v_track = 'current' then null else v_track end,
         coalesce(case when v_track <> 'current' then (select g.cost_kobo from public.ingredient_grade_prices g where g.ingredient_id = i.id and g.grade = v_track) end,
                  i.current_cost_kobo),
         t_hist, 'price_change', gen_random_uuid(), 'REHEARSAL', 'staff'
    from public.ingredients i where i.id in (select ingredient_id from public.recipe_items where recipe_id = v_ver);

  insert into public.late_entries (business_id, client_sale_id, paper_reference, actual_sold_at, delay_seconds, outage_reason, entered_by,
                                   payment_method, cash_kobo, transfer_kobo, total_kobo, status, source_shift_id) values
    (biz, gen_random_uuid(), 'ZZ-REH-L1-SPLIT', s_time, 1, 'rehearsal', owner, 'split',    half, rec.selling_price_kobo - half, rec.selling_price_kobo, 'needs_shift_review', null),
    (biz, gen_random_uuid(), 'ZZ-REH-L1-XFER',  s_time, 1, 'rehearsal', owner, 'transfer', 0, rec.selling_price_kobo, rec.selling_price_kobo, 'needs_shift_review', null);
  select id into e_split from public.late_entries where paper_reference = 'ZZ-REH-L1-SPLIT' and business_id = biz;
  select id into e_xfer  from public.late_entries where paper_reference = 'ZZ-REH-L1-XFER'  and business_id = biz;
  insert into public.late_entry_items (late_entry_id, business_id, recipe_id, dish_name, quantity, unit_price_kobo, line_total_kobo)
  select x, biz, v_ver, rec.name, 1, rec.selling_price_kobo, rec.selling_price_kobo from unnest(array[e_split, e_xfer]) x;

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);
  r := public.approve_and_post_late_entry(e_split, 'outside_shift_cash', 'Split sale, no shift open', null, null); o_split := (r ->> 'order_id')::uuid;
  r := public.approve_and_post_late_entry(e_xfer,  'outside_shift_cash', 'Transfer sale, no shift open', null, null); o_xfer := (r ->> 'order_id')::uuid;
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by, client_sale_id)
  select biz, 'walk_in', 'standard', 1000, 1000, 'paid', 'cash', 1000, 0, owner, gen_random_uuid() returning id into o_till;

  -- T1 a cashier cannot mark a transfer as lost
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'cashier', 'staff_id', owner))::text, true);
  begin perform public.mark_paper_transfer_lost(o_split, 'Customer never paid, three days'); ok := false;
  exception when others then ok := sqlerrm like 'Only a business owner%'; end;
  res := res || E'\nT1 a cashier cannot mark a transfer as lost: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);

  -- T2 a reason under 10 characters is refused
  begin perform public.mark_paper_transfer_lost(o_split, 'too short'); ok := false;
  exception when others then ok := sqlerrm like 'Type a reason of at least 10%'; end;
  ok := ok and (select status from public.orders where id = o_split) = 'awaiting_payment';
  res := res || E'\nT2 a reason under 10 characters is refused, sale still awaiting payment: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T3 a transfer-only sale (no cash taken) cannot be marked lost; a normal sale cannot either
  n := 0;
  begin perform public.mark_paper_transfer_lost(o_xfer, 'Customer never paid, three days'); exception when others then n := n + (sqlerrm like 'No cash was taken%')::int; end;
  begin perform public.mark_paper_transfer_lost(o_till, 'Customer never paid, three days'); exception when others then n := n + (sqlerrm like 'Only a paper sale%')::int; end;
  ok := n = 2;
  res := res || E'\nT3 transfer-only sale and normal sale refused: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T4 the owner marks the split sale's transfer as lost
  r := public.mark_paper_transfer_lost(o_split, 'Customer promised, never paid after 3 days');
  ok := (select status from public.orders where id = o_split) = 'transfer_lost' and not (r ->> 'already_marked')::boolean
    and exists (select 1 from public.paper_transfer_losses l where l.order_id = o_split and l.lost_kobo = rec.selling_price_kobo - half
                  and l.cash_kept_kobo = half and l.reason = 'Customer promised, never paid after 3 days' and l.marked_by = owner)
    and exists (select 1 from public.audit_logs a where a.action = 'paper_transfer_lost' and a.entity_id = o_split)
    and (select cash_amount_kobo from public.orders where id = o_split) = half;
  res := res || E'\nT4 owner marks the transfer lost -> final status, loss record, audit line, cash amount kept on the order: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T5 doing it again changes nothing
  r := public.mark_paper_transfer_lost(o_split, 'Customer promised, never paid after 3 days');
  ok := (r ->> 'already_marked')::boolean and (select count(*) from public.paper_transfer_losses where order_id = o_split) = 1;
  res := res || E'\nT5 marking twice -> one record: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T6 after that it cannot be confirmed, cancelled or refunded
  n := 0;
  begin perform public.confirm_paper_transfer(o_split, 'UBA ref 123456', 'late payment shown'); exception when others then n := n + 1; end;
  begin perform public.cancel_unpaid_order(o_split, 'changed my mind'); exception when others then n := n + 1; end;
  begin perform public.adjust_order(o_split, 'full_refund', 'customer wants money back', null); exception when others then n := n + 1; end;
  begin perform public.adjust_order(o_split, 'partial_refund', 'give part of cash back', 100); exception when others then n := n + 1; end;
  ok := n = 4 and (select status from public.orders where id = o_split) = 'transfer_lost';
  res := res || E'\nT6 a lost-transfer sale cannot be confirmed, cancelled or refunded: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T7 the cancel rule now points to the new way out, and a transfer-only sale can still be cancelled
  begin perform public.cancel_unpaid_order(o_xfer, 'customer never paid'); ok := (select status from public.orders where id = o_xfer) = 'cancelled';
  exception when others then ok := false; end;
  res := res || E'\nT7 a transfer-only paper sale that never arrives can still be cancelled: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T8 the app cannot write, change or delete a loss record
  n := 0;
  set local role authenticated;
  begin insert into public.paper_transfer_losses (business_id, order_id, reason, lost_kobo, cash_kept_kobo) values (biz, o_xfer, 'forged reason here', 1, 1); exception when others then n := n + 1; end;
  begin update public.paper_transfer_losses set reason = 'edited reason value'; exception when others then n := n + 1; end;
  begin delete from public.paper_transfer_losses; exception when others then n := n + 1; end;
  reset role;
  ok := n = 3;
  res := res || E'\nT8 app cannot insert, edit or delete a loss record: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T9 another business cannot mark it, a signed-out visitor cannot call it
  if other_owner is null then
    res := res || E'\nT9 another business refused: SKIPPED (no other business owner)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', other_owner, 'role', 'authenticated',
      'app_metadata', json_build_object('business_id', (select business_id from public.staff_users where id = other_owner), 'role', 'owner', 'staff_id', other_owner))::text, true);
    begin perform public.mark_paper_transfer_lost(o_split, 'other business trying this'); ok := false;
    exception when others then ok := sqlerrm like 'Order not found%'; end;
    res := res || E'\nT9 another business cannot mark this sale: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;
  set local role anon;
  begin perform public.mark_paper_transfer_lost(o_split, 'visitor trying this out'); ok := false; exception when insufficient_privilege then ok := true; when others then ok := false; end;
  reset role;
  res := res || E'\nT10 signed-out visitor cannot call it: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
