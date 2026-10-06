-- NairaPlate: rehearsal of the save-once sale functions (20261030) and dish price history (20261031) for the Demo Kitchen business. NOTHING IS SAVED.
-- Same method as rehearsal_demo_kitchen.sql: one block that acts as each role through the real functions and ends with a deliberate error,
-- so the database undoes everything. The first line of the error says ALL CLEAR or ATTENTION. Only rows that need a look are listed.
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and press Run. A red error starting "REHEARSAL DONE. NOTHING WAS SAVED." is the report.
do $rehearsal$
declare
  v text; res text; n_fail int; n_ok int; n_err int;
  biz constant text := 'demo-kitchen'; other constant text := 'mama-t';
  dish constant text := 'e6721229-a4f7-4659-8501-cd7249118959';        -- Eba & Egusi (dish id; its current recipe row has a different id)
  items text := '[{"recipe_id":"f830cd82-7953-4439-8a2c-98d90605967d","quantity":1}]';
  cid1 text := gen_random_uuid()::text; cid2 text := gen_random_uuid()::text; cid3 text := gen_random_uuid()::text; cid4 text := gen_random_uuid()::text;
  o_id text; sp text; pn text; o2 text;
begin
  if (select count(*) from public.businesses where id = biz) = 0 then raise exception 'Wrong project: no demo-kitchen business here. Nothing was done.'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_cash_order_once','set_dish_price')) < 2 then
    raise exception 'The save-once or price-history script has not been run here. Nothing was done.'; end if;

  execute $h$ create temp table rr (n serial, area text, step text, role text, expect text, outcome text, ok boolean, detail text) $h$;
  execute $h$ create or replace function pg_temp.u(r text) returns uuid language sql as $$
    select case r when 'owner' then '11111111-2222-4333-8444-555555555555'::uuid when 'supa_admin' then '11111111-2222-4333-8444-555555555555'::uuid
      when 'cashier' then 'd31b4e0f-1875-4fb6-a607-f84863bd8aa2'::uuid when 'purchaser' then 'a7c4b1cc-a49b-4c5d-b3b2-6db0f6317a75'::uuid
      when 'cook' then 'eafac359-5153-48ff-a7a0-93616b34bc59'::uuid else 'aaaaaaaa-0000-4000-8000-000000000009'::uuid end $$ $h$;
  execute $h$ create or replace function pg_temp.t(p_area text, p_step text, p_role text, p_q text, p_expect text, p_biz text default 'demo-kitchen', p_uid uuid default null)
    returns text language plpgsql as $f$
    declare v text; o text; d text; st text; good boolean;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', coalesce(p_uid, pg_temp.u(p_role)), 'role', case when p_role = 'anon' then 'anon' else 'authenticated' end,
        'app_metadata', json_build_object('business_id', p_biz, 'role', p_role, 'staff_id', coalesce(p_uid, pg_temp.u(p_role))))::text, true);
      if p_role = 'anon' then set local role anon; else set local role authenticated; end if;
      begin
        execute p_q into v;
        if v = '0' then o := 'NO_ROWS'; else o := 'ALLOWED'; end if;
        d := left(coalesce(v, ''), 150);
      exception when others then
        get stacked diagnostics st = returned_sqlstate;
        d := left(sqlerrm, 150); v := null;
        o := case when st in ('42601','42703','42P01','42883','42804','22P02','42P18','42702','42P10') then 'TEST_ERROR' else 'REFUSED' end;
      end;
      reset role;
      good := case p_expect when 'INFO' then null when 'ALLOWED' then o = 'ALLOWED' when 'BLOCKED' then o in ('REFUSED','NO_ROWS') else false end;
      if o = 'TEST_ERROR' then good := false; end if;
      insert into pg_temp.rr (area, step, role, expect, outcome, ok, detail) values (p_area, p_step, p_role, p_expect, o, good, d);
      return v;
    end $f$ $h$;
  execute $h$ create or replace function pg_temp.dml(p text) returns text language sql as $$ select 'with x as (' || p || ' returning 1) select count(*)::text from x' $$ $h$;
  execute $h$ create or replace function pg_temp.srv(p_area text, p_step text, p_sql text, p_expect text) returns void language plpgsql as $f$
    declare o text; d text; good boolean;
    begin
      perform set_config('request.jwt.claims', '', true);
      begin execute p_sql; o := 'ALLOWED'; d := ''; exception when others then o := 'REFUSED'; d := left(sqlerrm, 150); end;
      good := case p_expect when 'BLOCKED' then o = 'REFUSED' else o = 'ALLOWED' end;
      insert into pg_temp.rr (area, step, role, expect, outcome, ok, detail) values (p_area, p_step, 'server', p_expect, o, good, d);
    end $f$ $h$;
  execute $h$ create or replace function pg_temp.note(a text, s text, d text) returns void language sql as $$ insert into pg_temp.rr (area, step, role, expect, outcome, ok, detail) values (a, s, 'system', 'INFO', 'INFO', null, d) $$ $h$;

  -- ===== A. SAVE-ONCE SALES (20261030) =====
  v := pg_temp.t('Save once','Cashier saves a cash sale with a sale code','cashier', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid1, items), 'ALLOWED');
  o_id := (v::jsonb ->> 'order_id');
  v := pg_temp.t('Save once','Sending the same sale code again returns the same order and says it was already saved','cashier', format($q$select count(*)::text from (select 1 where (public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)->>'already_saved') = 'true' and (public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)->>'order_id') = %L) x$q$, cid1, items, cid1, items, o_id), 'ALLOWED');
  v := pg_temp.t('Save once','Only one order exists for that sale code','owner', format($q$select count(*)::text from (select 1 from public.orders where client_sale_id = %L::uuid having count(*) = 1) x$q$, cid1), 'ALLOWED');
  v := pg_temp.t('Save once','"Check again" finds the saved sale','cashier', format($q$select count(*)::text from (select 1 where (public.find_sale_by_client_id(%L::uuid)->>'found') = 'true') x$q$, cid1), 'ALLOWED');
  v := pg_temp.t('Save once','"Check again" for an unknown code says not found','cashier', format($q$select count(*)::text from (select 1 where (public.find_sale_by_client_id(%L::uuid)->>'found') = 'false') x$q$, cid2), 'ALLOWED');
  v := pg_temp.t('Save once','Cook cannot use "Check again"','cook', format($q$select public.find_sale_by_client_id(%L::uuid)::text$q$, cid1), 'BLOCKED');
  v := pg_temp.t('Save once','Signed-out visitor cannot use "Check again"','anon', format($q$select public.find_sale_by_client_id(%L::uuid)::text$q$, cid1), 'BLOCKED');
  v := pg_temp.t('Save once','Another business cannot find our sale by its code','owner', format($q$select count(*)::text from (select 1 where (public.find_sale_by_client_id(%L::uuid)->>'found') = 'true') x$q$, cid1), 'BLOCKED', other);
  v := pg_temp.t('Save once','Cook cannot take a sale with a new code','cook', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid3, items), 'BLOCKED');
  v := pg_temp.t('Save once','Purchaser cannot take a sale with a new code','purchaser', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid3, items), 'BLOCKED');
  v := pg_temp.t('Save once','Signed-out visitor cannot take a sale','anon', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid3, items), 'BLOCKED');
  v := pg_temp.t('Save once','A sale with no code is refused','cashier', format($q$select public.create_cash_order_once(null,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'BLOCKED');
  v := pg_temp.t('Save once','Cash that does not add up is refused and saves nothing','cashier', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',1000,0,%L::jsonb)::text$q$, cid3, items), 'BLOCKED');
  v := pg_temp.t('Save once','Nothing was saved under that refused code','owner', format($q$select count(*)::text from (select 1 where not exists (select 1 from public.orders where client_sale_id = %L::uuid)) x$q$, cid3), 'ALLOWED');
  v := pg_temp.t('Save once','A cook who knows an existing sale code cannot read that sale back','cook', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid1, items), 'BLOCKED');
  v := pg_temp.t('Save once','A purchaser who knows an existing sale code cannot read that sale back','purchaser', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, cid1, items), 'BLOCKED');
  v := pg_temp.t('Save once','Credit sale saved once','cashier', format($q$select public.create_credit_order_once(%L::uuid,'Walk-in','Standard','Once Customer','08000000001',%L::jsonb)::text$q$, cid4, items), 'ALLOWED');
  v := pg_temp.t('Save once','Sending the credit sale again does not make a second debt','cashier', format($q$select public.create_credit_order_once(%L::uuid,'Walk-in','Standard','Once Customer','08000000001',%L::jsonb)::text$q$, cid4, items), 'ALLOWED');
  v := pg_temp.t('Save once','Exactly one debt exists for that customer','owner', $q$select count(*)::text from (select 1 from public.customer_credits where customer_name = 'Once Customer' having count(*) = 1) x$q$, 'ALLOWED');
  v := pg_temp.t('Save once','Automatic transfer sale (shop has it switched off)','cashier', format($q$select public.create_transfer_order_once(%L::uuid,'Walk-in','Standard',%L::jsonb)::text$q$, gen_random_uuid(), items), 'INFO');
  v := pg_temp.t('Save once table','Nobody can change a sale code afterwards','cashier', pg_temp.dml(format($q$update public.orders set client_sale_id = gen_random_uuid() where id = %L$q$, o_id)), 'BLOCKED');
  v := pg_temp.t('Save once table','The helper that stamps the code cannot be called by staff','cashier', format($q$select public.sale_once_stamp(%L, %L::uuid, gen_random_uuid())::text$q$, biz, o_id), 'BLOCKED');

  -- ===== B. DISH PRICE HISTORY (20261031) =====
  v := pg_temp.t('Price history','The price in force now comes from history (Eba & Egusi, 150000)','owner', format($q$select count(*)::text from public.dish_price_at(%L::uuid, now()) where price_kobo = 150000$q$, dish), 'ALLOWED');
  v := pg_temp.t('Price history','Cashier cannot set a price','cashier', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','Purchaser cannot set a price','purchaser', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','Cook cannot set a price','cook', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','Signed-out visitor cannot set a price','anon', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','Another business cannot set our dish price','owner', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'BLOCKED', other);
  v := pg_temp.t('Price history','A price of zero or less is refused','owner', format($q$select public.set_dish_price(%L::uuid, 0, null)::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','A price cannot start in the past','owner', format($q$select public.set_dish_price(%L::uuid, 160000, now() - interval '1 hour')::text$q$, dish), 'BLOCKED');
  v := pg_temp.t('Price history','Owner schedules a price for tomorrow','owner', format($q$select public.set_dish_price(%L::uuid, 170000, now() + interval '1 day')::text$q$, dish), 'ALLOWED');
  sp := v;
  v := pg_temp.t('Price history','Two prices cannot start at the same moment','owner', format($q$select public.set_dish_price(%L::uuid, 175000, %L::timestamptz)::text$q$, dish, (select effective_from::text from public.dish_prices where id = sp::uuid)), 'BLOCKED');
  v := pg_temp.t('Price history','The scheduled price is not in force yet','owner', format($q$select count(*)::text from public.dish_price_at(%L::uuid, now()) where price_kobo = 150000$q$, dish), 'ALLOWED');
  v := pg_temp.t('Price history','It is in force from its start time','owner', format($q$select count(*)::text from public.dish_price_at(%L::uuid, now() + interval '2 days') where price_kobo = 170000$q$, dish), 'ALLOWED');
  v := pg_temp.t('Price history','Cashier cannot cancel a scheduled price','cashier', format($q$select public.cancel_dish_price(%L::uuid)::text$q$, sp), 'BLOCKED');
  v := pg_temp.t('Price history','Owner cancels the scheduled price','owner', format($q$select public.cancel_dish_price(%L::uuid)::text$q$, sp), 'ALLOWED');
  v := pg_temp.t('Price history','A price cannot be cancelled twice','owner', format($q$select public.cancel_dish_price(%L::uuid)::text$q$, sp), 'BLOCKED');
  v := pg_temp.t('Price history','After cancelling, the old price stands','owner', format($q$select count(*)::text from public.dish_price_at(%L::uuid, now() + interval '2 days') where price_kobo = 150000$q$, dish), 'ALLOWED');
  v := pg_temp.t('Price history','Owner sets a price starting now','owner', format($q$select public.set_dish_price(%L::uuid, 160000, null)::text$q$, dish), 'ALLOWED');
  pn := v;
  v := pg_temp.t('Price history','Today''s price on the dish follows the history (copy kept in step)','owner', format($q$select count(*)::text from public.recipes where dish_id = %L::uuid and is_current and selling_price_kobo = 160000$q$, dish), 'ALLOWED');
  v := pg_temp.t('Price history','A sale at the OLD price is refused','cashier', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, gen_random_uuid(), items), 'BLOCKED');
  v := pg_temp.t('Price history','A sale at the NEW price is saved','cashier', format($q$select public.create_cash_order_once(%L::uuid,'Walk-in','Standard','cash',160000,0,%L::jsonb)::text$q$, gen_random_uuid(), items), 'ALLOWED');
  o2 := (v::jsonb ->> 'order_id');
  v := pg_temp.t('Price history','The order line records which price row it used','owner', format($q$select count(*)::text from public.order_items where order_id = %L::uuid and dish_price_id = %L::uuid and unit_price_kobo = 160000$q$, o2, pn), 'ALLOWED');
  v := pg_temp.t('Price history','The earlier sale keeps its own price row','owner', format($q$select count(*)::text from public.order_items i join public.dish_prices p on p.id = i.dish_price_id where i.order_id = %L::uuid and p.price_kobo = 150000$q$, o_id), 'ALLOWED');
  v := pg_temp.t('Price history table','Owner cannot insert a price row directly','owner', pg_temp.dml(format($q$insert into public.dish_prices (business_id, dish_id, price_kobo, effective_from, source) values ('demo-kitchen', %L, 1, now() + interval '5 days', 'owner')$q$, dish)), 'BLOCKED');
  v := pg_temp.t('Price history table','Owner cannot edit a price row directly','owner', pg_temp.dml($q$update public.dish_prices set price_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Price history table','Owner cannot delete a price row directly','owner', pg_temp.dml($q$delete from public.dish_prices where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  perform pg_temp.srv('Price history table','Even the server cannot change a started price','update public.dish_prices set price_kobo = 1 where id = ' || quote_literal(pn) || '::uuid', 'BLOCKED');
  perform pg_temp.srv('Price history table','Even the server cannot delete a price row','delete from public.dish_prices where id = ' || quote_literal(pn) || '::uuid', 'BLOCKED');
  v := pg_temp.t('Price history','A price that has started cannot be cancelled','owner', format($q$select public.cancel_dish_price(%L::uuid)::text$q$, pn), 'BLOCKED');
  v := pg_temp.t('Price history table','Another business cannot read our price history','owner', format($q$select count(*)::text from public.dish_prices where dish_id = %L::uuid$q$, dish), 'BLOCKED', other);
  v := pg_temp.t('Price history table','Cashier can read the price history (own business)','cashier', format($q$select count(*)::text from public.dish_prices where dish_id = %L::uuid$q$, dish), 'ALLOWED');
  perform pg_temp.note('Price history','Price rows for this dish now (including this test)', (select count(*)::text from public.dish_prices where dish_id = dish::uuid));
  perform pg_temp.note('Result','Audit events made in this test', coalesce((select string_agg(action || ':' || n, ', ' order by action) from (select action, count(*) n from public.audit_logs where created_at = now() group by 1) s), 'none'));

  select count(*) filter (where ok is false), count(*) filter (where ok is true), count(*) filter (where outcome = 'TEST_ERROR') into n_fail, n_ok, n_err from pg_temp.rr;
  select string_agg(format('%s | %s | %s | %s | expect %s | %s%s | %s', n, area, step, role, expect, outcome, case when ok is false then '  <== FINDING' else '' end, detail), E'\n' order by n) into res from pg_temp.rr where ok is distinct from true;
  raise exception E'REHEARSAL DONE. NOTHING WAS SAVED. % (passed=%, findings=%, test_errors=%)\n%', case when n_fail = 0 and n_err = 0 then 'ALL CLEAR' else 'ATTENTION: look at the FINDING rows' end, n_ok, n_fail, n_err, coalesce(res, 'no rows to show');
end $rehearsal$;
