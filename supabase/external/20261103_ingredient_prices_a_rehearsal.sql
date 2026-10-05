-- Rehearsal for 20261103_ingredient_prices_a.sql on Demo Kitchen. NOTHING IS SAVED.
-- Run AFTER the migration. Paste the whole file into the Supabase SQL editor and press Run.
-- It ALWAYS ends with a red error starting "REHEARSAL DONE. NOTHING WAS SAVED." - that error is the report, not a fault,
-- and it makes the database undo every test change. First line: ALL CLEAR or ATTENTION, then one line per test.
do $rehearsal$
declare
  biz   constant text := 'demo-kitchen';
  owner constant uuid := '11111111-2222-4333-8444-555555555555';
  ing uuid; unit text; g_free text; n0 bigint; n1 bigint; r jsonb; pid uuid; evt uuid; c0 bigint; t0 timestamptz;
  ok boolean; res text := ''; fails int := 0; v text;
  procedure_ok boolean;
begin
  if not exists (select 1 from public.businesses where id = biz) then raise exception 'Wrong project: no demo-kitchen business. Nothing was done.'; end if;
  if to_regclass('public.ingredient_price_history') is null then raise exception 'Run 20261103_ingredient_prices_a.sql first. Nothing was done.'; end if;

  select i.id, i.base_unit into ing, unit from public.ingredients i where i.business_id = biz order by i.name limit 1;
  if ing is null then raise exception 'Demo Kitchen has no ingredients to test with. Nothing was done.'; end if;
  select x into g_free from unnest(array['C','B','A']) x
   where not exists (select 1 from public.ingredient_price_history h where h.ingredient_id = ing and h.price_track = x) limit 1;

  -- act as the Demo Kitchen owner
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'owner', 'staff_id', owner))::text, true);
  perform set_config('request.jwt.claim.sub', owner::text, true);

  -- T1 the app cannot read the table directly
  set local role authenticated;
  begin perform 1 from public.ingredient_price_history limit 1; ok := false; exception when insufficient_privilege then ok := true; end;
  reset role;
  res := res || E'\nT1 app cannot read the table directly: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T2 the app cannot write the table directly
  set local role authenticated;
  begin
    insert into public.ingredient_price_history (business_id, ingredient_id, price_track, cost_per_base_unit_kobo, effective_from, source_type, source_id, source_reference, recorded_by_kind)
    values (biz, ing, 'current', 1, now(), 'price_change', gen_random_uuid(), 'forged', 'staff');
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  res := res || E'\nT2 app cannot write the table directly: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T3 manual price change writes 2 linked rows + 1 audit entry
  select count(*) into n0 from public.ingredient_price_history where ingredient_id = ing;
  set local role authenticated;
  r := public.set_ingredient_price(ing, 12345, 'A', 'normal');
  reset role;
  evt := (r ->> 'price_event_id')::uuid;
  select count(*) into n1 from public.ingredient_price_history where ingredient_id = ing;
  ok := n1 - n0 = 2
    and (select count(*) from public.ingredient_price_history where source_type = 'price_change' and source_id = evt and cost_per_base_unit_kobo = 12345) = 2
    and exists (select 1 from public.audit_logs where action = 'ingredient_price_changed' and entity_id = evt);
  res := res || E'\nT3 price change -> 2 linked history rows + audit entry: ' || case when ok then 'PASS' else 'FAIL (' || (n1 - n0) || ' rows)' end; fails := fails + (not ok)::int;

  -- T4 a refused price change leaves no history row
  set local role authenticated;
  begin perform public.set_ingredient_price(ing, 0, 'A', 'normal'); exception when others then null; end;
  reset role;
  select count(*) into n0 from public.ingredient_price_history where ingredient_id = ing;
  ok := n0 = n1;
  res := res || E'\nT4 refused price change leaves no history row: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T5 purchase writes 2 rows linked to the purchase, at the purchase price
  set local role authenticated;
  r := public.log_purchase(ing, 2, unit, 50000, 'cash', 'B', 'scarce', null, null);
  reset role;
  pid := (r ->> 'purchase_id')::uuid; c0 := (r ->> 'current_cost_kobo')::bigint;
  ok := (select count(*) from public.ingredient_price_history where source_type = 'purchase' and source_id = pid and cost_per_base_unit_kobo = c0) = 2;
  res := res || E'\nT5 purchase -> 2 history rows at the purchase price: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T6 reversal writes the restoration rows (current back to 12345 grade A; grade B back to before or "no price")
  set local role authenticated;
  r := public.reverse_purchase(pid, 'Rehearsal test reversal');
  reset role;
  ok := exists (select 1 from public.ingredient_price_history where source_type = 'purchase_reversal' and source_id = (r ->> 'reversal_id')::uuid
                 and price_track = 'current' and cost_per_base_unit_kobo = 12345 and grade = 'A')
    and exists (select 1 from public.ingredient_price_history where source_type = 'purchase_reversal' and source_id = (r ->> 'reversal_id')::uuid and price_track = 'B');
  res := res || E'\nT6 reversal -> restoration rows: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T7 same-moment changes resolve deterministically to the LAST one recorded (reversal)
  set local role authenticated;
  select cost_per_base_unit_kobo into c0 from public.ingredient_price_at(ing, null, now());
  reset role;
  ok := c0 = 12345;
  res := res || E'\nT7 same-time changes -> last recorded wins: ' || case when ok then 'PASS' else 'FAIL (' || coalesce(c0::text, 'null') || ')' end; fails := fails + (not ok)::int;

  -- T8 before the earliest history -> explicit "unavailable", no substituted price
  set local role authenticated;
  select cost_basis_status || ':' || coalesce(cost_per_base_unit_kobo::text, 'null') into v from public.ingredient_price_at(ing, null, timestamptz '2000-01-01');
  reset role;
  ok := v = 'unavailable_before_history:null';
  res := res || E'\nT8 before history -> unavailable, no price: ' || case when ok then 'PASS' else 'FAIL (' || v || ')' end; fails := fails + (not ok)::int;

  -- T9 a grade with no history -> unavailable, never another grade's price
  if g_free is null or g_free in ('A','B') then
    res := res || E'\nT9 missing grade -> unavailable: SKIPPED (this ingredient already has grade C history)';
  else
    set local role authenticated;
    select cost_basis_status || ':' || coalesce(cost_per_base_unit_kobo::text, 'null') into v from public.ingredient_price_at(ing, 'C', now());
    reset role;
    ok := v = 'unavailable_before_history:null';
    res := res || E'\nT9 missing grade -> unavailable, no other grade used: ' || case when ok then 'PASS' else 'FAIL (' || v || ')' end; fails := fails + (not ok)::int;
  end if;

  -- T10 another business sees nothing of Demo Kitchen
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', 'zz-other-business', 'role', 'owner'))::text, true);
  set local role authenticated;
  begin
    select count(*) into n0 from public.ingredient_price_history_for(ing, null);
    ok := n0 = 0;
  exception when others then ok := true;  -- refused (e.g. no active plan) is also safe
  end;
  reset role;
  res := res || E'\nT10 another business cannot see this history: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T11 a cashier cannot read price history
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
    'app_metadata', json_build_object('business_id', biz, 'role', 'cashier'))::text, true);
  set local role authenticated;
  begin perform public.ingredient_price_history_for(ing, null); ok := false; exception when others then ok := true; end;
  reset role;
  res := res || E'\nT11 cashier cannot read price history: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T12 history cannot be edited or deleted, even from the SQL editor
  begin update public.ingredient_price_history set cost_per_base_unit_kobo = 1 where ingredient_id = ing; ok := false; exception when others then ok := true; end;
  begin delete from public.ingredient_price_history where ingredient_id = ing; ok := ok and false; exception when others then ok := ok and true; end;
  res := res || E'\nT12 history cannot be edited or deleted: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  -- T13 an ingredient with price history cannot be deleted
  begin delete from public.ingredients where id = ing; ok := false; exception when others then ok := true; end;
  res := res || E'\nT13 ingredient with price history cannot be deleted: ' || case when ok then 'PASS' else 'FAIL' end; fails := fails + (not ok)::int;

  raise exception 'REHEARSAL DONE. NOTHING WAS SAVED. %  (% failed)%',
    case when fails = 0 then 'ALL CLEAR' else 'ATTENTION' end, fails, res;
end $rehearsal$;
