-- Rehearsal for 20261109_dish_price_strict_a.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER the migration. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
-- Two tests need a sale time that is before the dish's first recorded price AND inside the 72-hour window; that is only possible until
-- 72 hours after the first price was recorded. When it is not possible the test says SKIPPED (not a failure).
do $rehearsal$
declare
  biz constant text := 'demo-kitchen';
  owner uuid; rec record; v_dish uuid; first_at timestamptz; before_at timestamptz; later_at timestamptz;
  p_now bigint; p_strict bigint; r jsonb; n int; ok boolean; msg text; res text := ''; fails int := 0; cnt bigint;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if to_regprocedure('public.dish_price_strict(uuid,timestamptz)') is null then raise exception 'Run 20261109_dish_price_strict_a.sql first. Nothing was done.'; end if;
  if not public.business_has_access(biz) then raise exception 'Demo Kitchen''s plan has ended. Nothing was done.'; end if;
  select su.id into owner from public.staff_users su join auth.users u on u.id = su.id
   where su.business_id = biz and su.role = 'owner' order by su.created_at limit 1;
  if owner is null then raise exception 'No Demo Kitchen owner sign-in found. Nothing was done.'; end if;

  select r0.* into rec from public.recipes r0
   where r0.business_id = biz and r0.is_current
     and exists (select 1 from public.dish_prices dp where dp.dish_id = coalesce(r0.dish_id, r0.id) and dp.cancelled_at is null and dp.effective_from <= now())
   order by r0.name limit 1;
  if rec.id is null then raise exception 'Demo Kitchen has no dish with a recorded price to test with. Nothing was done.'; end if;
  v_dish := coalesce(rec.dish_id, rec.id);
  select min(dp.effective_from) into first_at from public.dish_prices dp where dp.dish_id = v_dish and dp.cancelled_at is null;
  before_at := first_at - interval '1 hour';
  later_at := now() - interval '2 hours';

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- T1 the price in force now is the same through both lookups
  select s.price_kobo into p_strict from public.dish_price_strict(v_dish, now()) s;
  select a.price_kobo into p_now from public.dish_price_at(v_dish, now()) a;
  ok := p_strict is not null and p_strict = p_now;
  res := res || E'\nT1 price in force now: strict lookup equals the Till lookup: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T2 any saved version of the dish gives the same answer as the dish identifier
  select s.price_kobo into p_now from public.dish_price_strict(rec.id, now()) s;
  ok := p_now is not distinct from p_strict;
  res := res || E'\nT2 menu row identifier and dish identifier give the same price: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T3 before the first recorded price: strict gives nothing, the Till lookup still gives the earliest price (and is unchanged)
  select count(*) into n from public.dish_price_strict(v_dish, before_at);
  select count(*) into cnt from public.dish_price_at(v_dish, before_at);
  ok := n = 0 and cnt = 1;
  res := res || E'\nT3 before the first price: strict gives nothing, the Till lookup is unchanged: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T4 a dish with no history at all gives nothing
  select count(*) into n from public.dish_price_strict(gen_random_uuid(), now());
  ok := n = 0;
  res := res || E'\nT4 a dish with no price history gives nothing: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T5 a paper entry for a sale before the first price is refused, names the dish and the first price date, saves nothing
  if now() - before_at >= interval '72 hours' - interval '10 minutes' then
    res := res || E'\nT5 paper entry before the first price refused: SKIPPED (the 72-hour window for sales before the first price has closed)';
  else
    select count(*) into n from public.late_entries where business_id = biz;
    begin
      perform public.submit_late_entry(gen_random_uuid(), 'ZZ-REH-D9', before_at, 'rehearsal', 'cash', 1000, 0,
        jsonb_build_array(jsonb_build_object('recipe_id', rec.id, 'quantity', 1)));
      ok := false; msg := 'no error';
    exception when others then
      msg := sqlerrm;
      ok := sqlerrm like 'No menu price was on record for "' || rec.name || '"%' and sqlerrm like '%first recorded price starts on%';
    end;
    ok := ok and (select count(*) from public.late_entries where business_id = biz) = n;
    res := res || E'\nT5 paper entry before the first price refused, names the dish and the first price date, nothing saved: ' || case when ok then 'PASS' else 'FAIL (' || msg || ')' end; fails := fails + (not ok)::int;
  end if;

  -- T6 a paper entry for a sale after the first price is priced from the price in force then, and links that price row
  if first_at > later_at then
    res := res || E'\nT6 paper entry after the first price: SKIPPED (the dish\'s first price is newer than two hours)';
  else
    select s.price_kobo into p_strict from public.dish_price_strict(v_dish, later_at) s;
    r := public.submit_late_entry(gen_random_uuid(), 'ZZ-REH-D9B', later_at, 'rehearsal', 'cash', p_strict, 0,
      jsonb_build_array(jsonb_build_object('recipe_id', rec.id, 'quantity', 1)));
    ok := (r ->> 'status') in ('submitted', 'needs_shift_review')
      and exists (select 1 from public.late_entry_items i join public.late_entries e on e.id = i.late_entry_id
                   where e.paper_reference = 'ZZ-REH-D9B' and e.business_id = biz and i.unit_price_kobo = p_strict
                     and i.dish_price_id = (select s2.id from public.dish_price_strict(v_dish, later_at) s2));
    res := res || E'\nT6 paper entry after the first price: priced from the price in force then, price row linked: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;
  end if;

  -- T7 a signed-out visitor cannot use the lookup; a signed-in person can
  set local role anon;
  begin perform * from public.dish_price_strict(v_dish, now()); ok := false; exception when insufficient_privilege then ok := true; when others then ok := false; end;
  reset role;
  set local role authenticated;
  begin perform * from public.dish_price_strict(v_dish, now()); exception when others then ok := false; end;
  reset role;
  res := res || E'\nT7 signed-out visitor cannot use the lookup, signed-in person can: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
