-- NairaPlate Step 6: transaction rehearsal for the Demo Kitchen business. NOTHING IS SAVED.
-- The whole script is one block that always ends with a deliberate error, so the database undoes every change it made.
-- It acts as each role (owner, cashier, purchaser, cook, signed-out visitor, and an owner of another business) using real database
-- functions and policies, and reports what was allowed or refused. Safe to re-run. Read the result in the error message.
-- "expect" is the safe outcome: ALLOWED for things a role should be able to do, BLOCKED for things nobody should be able to do.
-- A row with ok = false is a finding. TEST_ERROR means the test itself was wrong (never counted as a pass).
do $rehearsal$
declare
  v text; j jsonb;
  biz constant text := 'demo-kitchen'; other constant text := 'mama-t';
  eba constant text := 'f830cd82-7953-4439-8a2c-98d90605967d';
  garri constant text := '77f449f4-87b7-436b-a623-aa29798057a2'; egusi constant text := '5d2b3f1f-ec0b-473b-9dee-3aa948937e85'; rice constant text := '44ba2690-f4ee-420b-9f6e-413552c500da';
  supplier constant text := '6c4dfc9f-2891-4045-86b6-59e0b3a16c6a';
  credit_open constant text := 'ba8f5112-4638-48ac-bb16-4333ec983e85'; cat_open constant text := '2d025e15-25e9-4c7b-82d2-39bdf31d0798';
  items text := '[{"recipe_id":"f830cd82-7953-4439-8a2c-98d90605967d","quantity":1}]';
  o1 text; o2 text; cr text; pur1 text; oldp text; pay1 text; cp text; cnt text; d1 text; d_stale text; pcount text; res text; n_fail int; n_ok int; n_err int;
begin
  if (select count(*) from public.businesses where id = biz) = 0 then raise exception 'Wrong project: no demo-kitchen business here. Nothing was done.'; end if;

  -- ===== harness (temporary objects; they vanish with the rollback) =====
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
  execute $h$ create or replace function pg_temp.note(a text, s text, d text) returns void language sql as $$ insert into pg_temp.rr (area, step, role, expect, outcome, ok, detail) values (a, s, 'system', 'INFO', 'INFO', null, d) $$ $h$;

  -- ===== 1. SALES, VOIDS AND REFUNDS =====
  v := pg_temp.t('Sales','Cashier takes a cash sale (real till function)','cashier', format($q$select public.create_cash_order('Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'ALLOWED');
  o1 := (v::jsonb ->> 'order_id');
  v := pg_temp.t('Sales','Cook cannot take a sale','cook', format($q$select public.create_cash_order('Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'BLOCKED');
  v := pg_temp.t('Sales','Purchaser cannot take a sale','purchaser', format($q$select public.create_cash_order('Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'BLOCKED');
  v := pg_temp.t('Sales','Signed-out visitor cannot take a sale','anon', format($q$select public.create_cash_order('Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'BLOCKED');
  v := pg_temp.t('Sales','Cash that does not add up to the total is refused','cashier', format($q$select public.create_cash_order('Walk-in','Standard','cash',1000,0,%L::jsonb)::text$q$, items), 'BLOCKED');
  v := pg_temp.t('Sales','Stock used by that sale (rows made in this test)','owner', $q$select count(*)::text from public.stock_movements where reason = 'sale_use' and created_at = now()$q$, 'INFO');
  v := pg_temp.t('Sales','Cook cannot void a sale','cook', format($q$select public.adjust_order(%L, 'void', 'trying to void', null)::text$q$, o1), 'BLOCKED');
  v := pg_temp.t('Sales','Cashier voids the sale with a reason','cashier', format($q$select public.adjust_order(%L, 'void', 'customer left the till', null)::text$q$, o1), 'ALLOWED');
  v := pg_temp.t('Sales','The same sale cannot be voided twice','cashier', format($q$select public.adjust_order(%L, 'void', 'second try on same order', null)::text$q$, o1), 'BLOCKED');
  v := pg_temp.t('Sales','Stock put back by the void (rows made in this test)','owner', $q$select count(*)::text from public.stock_movements where reason = 'sale_void' and created_at = now()$q$, 'INFO');
  v := pg_temp.t('Sales','Second cash sale','cashier', format($q$select public.create_cash_order('Walk-in','Standard','cash',150000,0,%L::jsonb)::text$q$, items), 'ALLOWED');
  o2 := (v::jsonb ->> 'order_id');
  v := pg_temp.t('Refunds','Cashier part-refunds the second sale','cashier', format($q$select public.adjust_order(%L, 'partial_refund', 'customer returned a plate', 30000)::text$q$, o2), 'ALLOWED');
  v := pg_temp.t('Refunds','A part refund bigger than what is left is refused','cashier', format($q$select public.adjust_order(%L, 'partial_refund', 'too large a refund', 150000)::text$q$, o2), 'BLOCKED');
  v := pg_temp.t('Refunds','Owner fully refunds what is left','owner', format($q$select public.adjust_order(%L, 'full_refund', 'order was wrong', null)::text$q$, o2), 'ALLOWED');
  v := pg_temp.t('Sales','Transfer sale (real till function)','cashier', format($q$select public.create_transfer_order('Walk-in','Standard',%L::jsonb)::text$q$, items), 'INFO');
  v := pg_temp.t('Sales','Credit sale creates a customer debt (real till function)','cashier', format($q$select public.create_credit_order('Walk-in','Standard','Rehearsal Customer','08000000000',%L::jsonb)::text$q$, items), 'ALLOWED');
  select id::text into cr from public.customer_credits where business_id = biz and customer_name = 'Rehearsal Customer' limit 1;
  v := pg_temp.t('Sales table','Cashier cannot insert an order directly','cashier', pg_temp.dml($q$insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo) values ('demo-kitchen','x','Standard',1,1,'paid','cash',1,0)$q$), 'BLOCKED');
  v := pg_temp.t('Sales table','Cashier cannot bring a voided sale back to life','cashier', pg_temp.dml(format($q$update public.orders set status = 'paid' where id = %L$q$, o1)), 'BLOCKED');
  v := pg_temp.t('Sales table','Owner cannot delete a sale','owner', pg_temp.dml(format($q$delete from public.orders where id = %L$q$, o1)), 'BLOCKED');
  v := pg_temp.t('Sales table','Cashier cannot add an order line directly','cashier', pg_temp.dml(format($q$insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo) values ('demo-kitchen', %L, %L, 1, 1)$q$, o2, eba)), 'BLOCKED');
  v := pg_temp.t('Refund records (A1)','Cashier cannot write a refund row directly','cashier', pg_temp.dml(format($q$insert into public.order_adjustments (business_id, order_id, type, original_amount_kobo, adjustment_amount_kobo, reason, actor_id) values ('demo-kitchen', %L, 'partial_refund', 150000, 100000, 'forged refund', %L)$q$, o2, pg_temp.u('cashier'))), 'BLOCKED');
  v := pg_temp.t('Refund records (A1)','Owner cannot edit a refund amount directly','owner', pg_temp.dml($q$update public.order_adjustments set adjustment_amount_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');

  -- ===== 2. PURCHASES, PRICES, STOCK =====
  v := pg_temp.t('Purchases','Purchaser logs a credit purchase from the supplier','purchaser', format($q$select public.log_purchase(%L, 2, 'kg', 170000, 'credit', 'B', 'normal', null, %L)::text$q$, garri, supplier), 'ALLOWED');
  pur1 := (v::jsonb ->> 'purchase_id');
  v := pg_temp.t('Purchases','Cashier cannot log a purchase','cashier', format($q$select public.log_purchase(%L, 2, 'kg', 170000, 'cash', 'B', 'normal', null, null)::text$q$, garri), 'BLOCKED');
  v := pg_temp.t('Purchases','Cook cannot log a purchase','cook', format($q$select public.log_purchase(%L, 2, 'kg', 170000, 'cash', 'B', 'normal', null, null)::text$q$, garri), 'BLOCKED');
  perform pg_temp.note('Purchases','What is owed to the supplier after the credit purchase (kobo)', public.supplier_balance_kobo(biz, supplier::uuid)::text);
  v := pg_temp.t('Purchases','Purchaser cannot reverse a purchase','purchaser', format($q$select public.reverse_purchase(%L, 'purchaser trying to reverse')::text$q$, pur1), 'BLOCKED');
  v := pg_temp.t('Purchases','Owner needs a reason of 5 or more characters','owner', format($q$select public.reverse_purchase(%L, 'no')::text$q$, pur1), 'BLOCKED');
  v := pg_temp.t('Purchases','Owner reverses the latest purchase with a reason','owner', format($q$select public.reverse_purchase(%L, 'entered against the wrong supplier')::text$q$, pur1), 'ALLOWED');
  v := pg_temp.t('Purchases','The same purchase cannot be reversed twice','owner', format($q$select public.reverse_purchase(%L, 'second reversal attempt')::text$q$, pur1), 'BLOCKED');
  perform pg_temp.note('Purchases','What is owed to the supplier after the reversal (kobo)', public.supplier_balance_kobo(biz, supplier::uuid)::text);
  select id::text into oldp from public.purchases where business_id = biz and price_set_at is null and kind = 'purchase' limit 1;
  v := pg_temp.t('Purchases','A purchase recorded before reversals existed cannot be reversed','owner', format($q$select public.reverse_purchase(%L, 'old purchase, no snapshot')::text$q$, oldp), 'BLOCKED');
  v := pg_temp.t('Purchases table','Purchaser cannot insert a purchase directly','purchaser', pg_temp.dml($q$insert into public.purchases (business_id, ingredient_id, qty, market_unit, total_kobo) values ('demo-kitchen','77f449f4-87b7-436b-a623-aa29798057a2',1,'kg',1)$q$), 'BLOCKED');
  v := pg_temp.t('Purchases table','Owner cannot edit a purchase amount','owner', pg_temp.dml($q$update public.purchases set total_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Purchases table','Owner cannot delete a purchase','owner', pg_temp.dml($q$delete from public.purchases where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Prices','Purchaser changes a price through the price function','purchaser', format($q$select public.set_ingredient_price(%L, 210000, 'B', 'normal')::text$q$, rice), 'ALLOWED');
  v := pg_temp.t('Prices','Cashier cannot change a price','cashier', format($q$select public.set_ingredient_price(%L, 1, 'B', 'normal')::text$q$, rice), 'BLOCKED');
  v := pg_temp.t('Ingredients','Purchaser cannot edit stock directly','purchaser', pg_temp.dml(format($q$update public.ingredients set stock_base_qty = 9999 where id = %L$q$, rice)), 'BLOCKED');
  v := pg_temp.t('Ingredients','Owner cannot edit the cost directly','owner', pg_temp.dml(format($q$update public.ingredients set current_cost_kobo = 1 where id = %L$q$, rice)), 'BLOCKED');
  v := pg_temp.t('Ingredients','Cannot add an ingredient with a starting stock','purchaser', pg_temp.dml($q$insert into public.ingredients (business_id, name, base_unit, stock_base_qty) values ('demo-kitchen','Free stock','kg',500)$q$), 'BLOCKED');
  v := pg_temp.t('Ingredients','Owner can still rename an ingredient','owner', pg_temp.dml(format($q$update public.ingredients set category = 'Grains' where id = %L$q$, garri)), 'ALLOWED');
  v := pg_temp.t('Ingredients','Unit cannot change once there is history','owner', pg_temp.dml(format($q$update public.ingredients set base_unit = 'g' where id = %L$q$, garri)), 'BLOCKED');
  v := pg_temp.t('Ingredients','Ingredient with history cannot be deleted','owner', pg_temp.dml(format($q$delete from public.ingredients where id = %L$q$, garri)), 'BLOCKED');
  v := pg_temp.t('Stock','Nobody can write a stock movement directly','owner', pg_temp.dml($q$insert into public.stock_movements (business_id, ingredient_id, qty_base, balance_after, reason) values ('demo-kitchen','77f449f4-87b7-436b-a623-aa29798057a2',1,1,'made up')$q$), 'BLOCKED');
  v := pg_temp.t('Stock','Nobody can delete a stock movement','owner', pg_temp.dml($q$delete from public.stock_movements where business_id = 'demo-kitchen'$q$), 'BLOCKED');

  -- ===== 3. SUPPLIER LEDGER =====
  v := pg_temp.t('Supplier','Purchaser records a supplier payment','purchaser', format($q$select public.record_supplier_payment(%L, 50000, 'rehearsal part payment')::text$q$, supplier), 'ALLOWED');
  pay1 := (v::jsonb ->> 'id');
  v := pg_temp.t('Supplier','Cashier cannot record a supplier payment','cashier', format($q$select public.record_supplier_payment(%L, 50000, 'x')::text$q$, supplier), 'BLOCKED');
  v := pg_temp.t('Supplier','Purchaser cannot reverse a payment','purchaser', format($q$select public.reverse_supplier_payment(%L, 'purchaser trying to reverse')::text$q$, pay1), 'BLOCKED');
  v := pg_temp.t('Supplier','Owner reverses the payment with a reason','owner', format($q$select public.reverse_supplier_payment(%L, 'paid the wrong supplier')::text$q$, pay1), 'ALLOWED');
  v := pg_temp.t('Supplier','The same payment cannot be reversed twice','owner', format($q$select public.reverse_supplier_payment(%L, 'second reversal attempt')::text$q$, pay1), 'BLOCKED');
  v := pg_temp.t('Supplier table','Cannot insert a supplier entry directly','purchaser', pg_temp.dml(format($q$insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo) values ('demo-kitchen', %L, 'payment', 1)$q$, supplier)), 'BLOCKED');
  v := pg_temp.t('Supplier table','Cannot edit a supplier entry','owner', pg_temp.dml($q$update public.supplier_transactions set amount_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Supplier table','Cannot delete a supplier entry','owner', pg_temp.dml($q$delete from public.supplier_transactions where business_id = 'demo-kitchen'$q$), 'BLOCKED');

  -- ===== 4. CUSTOMER CREDIT =====
  v := pg_temp.t('Credit','Cashier records a part-payment on the credit-sale debt','cashier', format($q$select public.record_credit_payment(%L, 50000, 'cash')::text$q$, cr), 'ALLOWED');
  select id::text into cp from public.credit_payments where credit_id = cr::uuid and kind = 'payment' limit 1;
  v := pg_temp.t('Credit','Paying more than is owed is refused','cashier', format($q$select public.record_credit_payment(%L, 999999, 'cash')::text$q$, cr), 'BLOCKED');
  v := pg_temp.t('Credit','Cook cannot record a debt payment','cook', format($q$select public.record_credit_payment(%L, 100, 'cash')::text$q$, cr), 'BLOCKED');
  v := pg_temp.t('Credit','Cashier cannot write off a debt','cashier', format($q$select public.write_off_credit(%L, null, 'cashier trying it')::text$q$, cr), 'BLOCKED');
  v := pg_temp.t('Credit','Owner writes off part of a debt with a reason','owner', format($q$select public.write_off_credit(%L, 20000, 'customer disputed part')::text$q$, cr), 'ALLOWED');
  v := pg_temp.t('Credit','Cashier cannot reverse a payment','cashier', format($q$select public.reverse_credit_entry(%L, 'cashier trying it')::text$q$, cp), 'BLOCKED');
  v := pg_temp.t('Credit','Owner reverses a payment with a reason','owner', format($q$select public.reverse_credit_entry(%L, 'payment was entered twice')::text$q$, cp), 'ALLOWED');
  v := pg_temp.t('Credit','Cashier cannot add a debt by hand','cashier', $q$select public.create_manual_credit('Sneaky', null, 5000, null)::text$q$, 'BLOCKED');
  v := pg_temp.t('Credit','Owner adds a debt by hand','owner', $q$select public.create_manual_credit('Rehearsal manual', null, 5000, 'test')::text$q$, 'ALLOWED');
  v := pg_temp.t('Credit table','Cashier cannot mark a debt settled directly','cashier', pg_temp.dml(format($q$update public.customer_credits set settled = true where id = %L$q$, credit_open)), 'BLOCKED');
  v := pg_temp.t('Credit table','Cashier cannot insert a debt directly','cashier', pg_temp.dml($q$insert into public.customer_credits (business_id, customer_name, amount_kobo) values ('demo-kitchen','x',1)$q$), 'BLOCKED');
  v := pg_temp.t('Credit table','Nobody can insert a credit payment directly','owner', pg_temp.dml(format($q$insert into public.credit_payments (business_id, credit_id, kind, amount_kobo, method) values ('demo-kitchen', %L, 'payment', 1, 'cash')$q$, credit_open)), 'BLOCKED');
  v := pg_temp.t('Credit table','Nobody can delete a debt','owner', pg_temp.dml($q$delete from public.customer_credits where business_id = 'demo-kitchen'$q$), 'BLOCKED');

  -- ===== 5. CATERING =====
  v := pg_temp.t('Catering','Cashier records a cash catering payment','cashier', format($q$select public.record_catering_payment_v2(%L, 100000, 'cash')::text$q$, cat_open), 'ALLOWED');
  v := pg_temp.t('Catering','Cook cannot record a catering payment','cook', format($q$select public.record_catering_payment_v2(%L, 100, 'cash')::text$q$, cat_open), 'BLOCKED');
  select id::text into cnt from public.catering_payments where order_id = cat_open::uuid and kind = 'payment' and created_at = now() limit 1;
  v := pg_temp.t('Catering','Cashier cannot reverse a catering payment','cashier', format($q$select public.reverse_catering_payment(%L, 'cashier trying it')::text$q$, cnt), 'BLOCKED');
  v := pg_temp.t('Catering','Owner reverses a catering payment with a reason','owner', format($q$select public.reverse_catering_payment(%L, 'recorded on the wrong order')::text$q$, cnt), 'ALLOWED');
  v := pg_temp.t('Catering table','Cashier cannot edit a catering order directly','cashier', pg_temp.dml($q$update public.catering_deposits set total_contract_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Catering table','Nobody can insert a catering payment directly','owner', pg_temp.dml(format($q$insert into public.catering_payments (business_id, order_id, kind, amount_kobo, method) values ('demo-kitchen', %L, 'payment', 1, 'cash')$q$, cat_open)), 'BLOCKED');

  -- ===== 6. WASTAGE, BATCHES, STOCK TAKE =====
  v := pg_temp.t('Wastage','Cook logs wastage (open by design; the database adjusts stock)','cook', pg_temp.dml(format($q$insert into public.wastage_logs (business_id, ingredient_id, qty, unit, cost_kobo, reason, logged_by) values ('demo-kitchen', %L, 0.1, 'kg', 8500, 'spoiled', %L)$q$, garri, pg_temp.u('cook'))), 'ALLOWED');
  v := pg_temp.t('Batches','Cook logs a batch (real batch function)','cook', format($q$select public.log_batch(%L, 1, 10, 0, 0, 0, %L::jsonb)::text$q$, eba, format('[{"ingredient_id":"%s","base_qty":0.2},{"ingredient_id":"%s","base_qty":0.1}]', garri, egusi)), 'ALLOWED');
  v := pg_temp.t('Batches','Cashier cannot log a batch','cashier', format($q$select public.log_batch(%L, 1, 10, 0, 0, 0, %L::jsonb)::text$q$, eba, format('[{"ingredient_id":"%s","base_qty":0.2},{"ingredient_id":"%s","base_qty":0.1}]', garri, egusi)), 'BLOCKED');
  v := pg_temp.t('Stock take','Purchaser submits a count (waits for an owner)','purchaser', format($q$select public.submit_stock_count('rehearsal count', false, %L::jsonb)::text$q$, format('[{"ingredient_id":"%s","counted_base":1,"note":"counted again"}]', rice)), 'ALLOWED');
  pcount := (v::jsonb ->> 'id');
  v := pg_temp.t('Stock take','Cashier cannot count stock','cashier', format($q$select public.submit_stock_count('x', false, %L::jsonb)::text$q$, format('[{"ingredient_id":"%s","counted_base":1,"note":"x"}]', rice)), 'BLOCKED');
  v := pg_temp.t('Stock take','Purchaser cannot approve a count','purchaser', format($q$select public.decide_stock_count(%L, true)::text$q$, pcount), 'BLOCKED');
  v := pg_temp.t('Stock take','Owner approves the count','owner', format($q$select public.decide_stock_count(%L, true)::text$q$, pcount), 'ALLOWED');
  v := pg_temp.t('Stock take','A decided count cannot be decided again','owner', format($q$select public.decide_stock_count(%L, true)::text$q$, pcount), 'BLOCKED');
  v := pg_temp.t('Stock take','Cook cannot edit stock directly','cook', pg_temp.dml(format($q$update public.ingredients set stock_base_qty = 0 where id = %L$q$, garri)), 'BLOCKED');

  -- ===== 7. CASH DRAWER (the stale 25 Sept shift is closed here the way the server would; undone at the end) =====
  perform set_config('request.jwt.claims', '', true); -- act as the server (no signed-in user) for the next change
  update public.cash_drawers set status = 'closed', closed_at = now(), forced = true, close_reason = 'rehearsal: stale shift', expected_cash_kobo = 0 where business_id = biz and status = 'open';
  select id::text into d_stale from public.cash_drawers where business_id = biz and forced and close_reason = 'rehearsal: stale shift' limit 1;
  v := pg_temp.t('Drawer','Cashier opens a shift','cashier', $q$select public.open_cash_drawer(200000)::text$q$, 'ALLOWED');
  v := pg_temp.t('Drawer','A second shift cannot open while one is open','owner', $q$select public.open_cash_drawer(1000)::text$q$, 'BLOCKED');
  v := pg_temp.t('Drawer','Cook cannot open a shift','cook', $q$select public.open_cash_drawer(1000)::text$q$, 'BLOCKED');
  v := pg_temp.t('Drawer','Signed-out visitor cannot open a shift','anon', $q$select public.open_cash_drawer(1000)::text$q$, 'BLOCKED');
  v := pg_temp.t('Drawer table','Cashier cannot insert a shift directly','cashier', pg_temp.dml($q$insert into public.cash_drawers (business_id, opened_by, opening_float_kobo) values ('demo-kitchen','d31b4e0f-1875-4fb6-a607-f84863bd8aa2', 5)$q$), 'BLOCKED');
  v := pg_temp.t('Drawer table','Cashier cannot close or change a shift directly','cashier', pg_temp.dml($q$update public.cash_drawers set status = 'closed', closing_counted_kobo = 1 where business_id = 'demo-kitchen' and status = 'open'$q$), 'BLOCKED');
  v := pg_temp.t('Drawer table','Nobody can delete a shift','owner', pg_temp.dml($q$delete from public.cash_drawers where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  perform set_config('request.jwt.claims', '', true);
  update public.cash_drawers set status = 'closed', closing_counted_kobo = 190000, expected_cash_kobo = 200000, discrepancy_kobo = -10000, closed_at = now() where business_id = biz and status = 'open';
  select id::text into d1 from public.cash_drawers where business_id = biz and closing_counted_kobo = 190000 limit 1;
  v := pg_temp.t('Drawer','Cashier cannot adjust a closed shift','cashier', format($q$select public.adjust_closed_drawer(%L, 10000, 'cashier trying it')::text$q$, d1), 'BLOCKED');
  v := pg_temp.t('Drawer','Owner adjusts a closed shift with a reason','owner', format($q$select public.adjust_closed_drawer(%L, 10000, 'typed the wrong count')::text$q$, d1), 'ALLOWED');
  v := pg_temp.t('Drawer','A shift closed without a count cannot be adjusted','owner', format($q$select public.adjust_closed_drawer(%L, 10000, 'no count to adjust')::text$q$, d_stale), 'BLOCKED');
  v := pg_temp.t('Drawer table','Owner cannot rewrite a closed shift','owner', pg_temp.dml(format($q$update public.cash_drawers set closing_counted_kobo = 200000, discrepancy_kobo = 0 where id = %L$q$, d1)), 'BLOCKED');
  v := pg_temp.t('Drawer table','Nobody can insert or edit an adjustment directly','owner', pg_temp.dml(format($q$insert into public.cash_drawer_adjustments (business_id, drawer_id, amount_kobo, reason) values ('demo-kitchen', %L, 1, 'direct insert')$q$, d1)), 'BLOCKED');

  -- ===== 8. TABLES WITH DIRECT WRITE POLICIES (what is still open) =====
  v := pg_temp.t('Audit trail (A2)','A cook cannot write a forged audit entry','cook', pg_temp.dml(format($q$insert into public.audit_logs (business_id, actor_id, actor_role, action, details) values ('demo-kitchen', %L, 'owner', 'drawer_discrepancy', 'forged entry')$q$, pg_temp.u('owner'))), 'BLOCKED');
  v := pg_temp.t('Audit trail','Nobody can edit an audit entry','owner', pg_temp.dml($q$update public.audit_logs set details = 'edited' where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Audit trail','Nobody can delete an audit entry','owner', pg_temp.dml($q$delete from public.audit_logs where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Payouts (A3)','Owner cannot write a channel payout directly','owner', pg_temp.dml($q$insert into public.channel_payouts (business_id, channel, gross_sales_kobo, commission_kobo, net_payout_kobo) values ('demo-kitchen','Chowdeck',1,1,1)$q$), 'BLOCKED');
  v := pg_temp.t('Payouts (A3)','Owner cannot edit a channel payout directly','owner', pg_temp.dml($q$update public.channel_payouts set net_payout_kobo = 1 where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Price decisions (A4)','Owner cannot write a price decision directly','owner', pg_temp.dml(format($q$insert into public.price_decisions (business_id, recipe_id, decision) values ('demo-kitchen', %L, 'accepted')$q$, eba)), 'BLOCKED');
  v := pg_temp.t('Batches (A4)','Owner cannot write a batch directly','owner', pg_temp.dml(format($q$insert into public.batches (business_id, recipe_id) values ('demo-kitchen', %L)$q$, eba)), 'BLOCKED');
  v := pg_temp.t('Batches (A4)','Owner cannot delete a batch directly','owner', pg_temp.dml($q$delete from public.batches where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Staff','Owner cannot change a staff role directly','owner', pg_temp.dml($q$update public.staff_users set role = 'platform_admin' where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Staff','Owner cannot set a PIN directly','owner', pg_temp.dml($q$update public.staff_users set pin_hash = 'x' where business_id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Staff','Cashier cannot read PIN hashes','cashier', $q$select count(pin_hash)::text from public.staff_users$q$, 'BLOCKED');
  v := pg_temp.t('Business','Owner cannot extend their own plan','owner', pg_temp.dml($q$update public.businesses set access_ends_at = now() + interval '10 years' where id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Business','Owner cannot change their approval status','owner', pg_temp.dml($q$update public.businesses set status = 'approved' where id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Business','Owner cannot delete their business with ledger history','owner', pg_temp.dml($q$delete from public.businesses where id = 'demo-kitchen'$q$), 'BLOCKED');
  v := pg_temp.t('Open by design','Owner edits a recipe name','owner', pg_temp.dml(format($q$update public.recipes set category = category where id = %L$q$, eba)), 'INFO');
  v := pg_temp.t('Open by design','Cook can delete an alert (margin_flags)','cook', pg_temp.dml($q$delete from public.margin_flags where business_id = 'demo-kitchen'$q$), 'INFO');
  v := pg_temp.t('Open by design','Owner can delete a wastage entry','owner', pg_temp.dml($q$delete from public.wastage_logs where business_id = 'demo-kitchen'$q$), 'INFO');
  v := pg_temp.t('Open by design','Owner can edit a unit conversion','owner', pg_temp.dml($q$update public.unit_conversions set base_qty = base_qty where business_id = 'demo-kitchen'$q$), 'INFO');

  -- ===== 9. OTHER BUSINESS AND SIGNED-OUT VISITORS =====
  v := pg_temp.t('Other business','Another business cannot see our orders','owner', $q$select count(*)::text from public.orders where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot see our purchases','owner', $q$select count(*)::text from public.purchases where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot see our debts','owner', $q$select count(*)::text from public.customer_credits where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot see our shifts','owner', $q$select count(*)::text from public.cash_drawers where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot see our audit trail','owner', $q$select count(*)::text from public.audit_logs where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot see our staff','owner', $q$select count(*)::text from public.staff_users where business_id = 'demo-kitchen'$q$, 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot take a payment on our debt','owner', format($q$select public.record_credit_payment(%L, 100, 'cash')::text$q$, credit_open), 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot write off our debt','owner', format($q$select public.write_off_credit(%L, null, 'not your debt')::text$q$, credit_open), 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot adjust our shift','owner', format($q$select public.adjust_closed_drawer(%L, 100, 'not your shift')::text$q$, d1), 'BLOCKED', other);
  v := pg_temp.t('Other business','Another business cannot reverse our payment','owner', format($q$select public.reverse_catering_payment(%L, 'not your payment')::text$q$, cnt), 'BLOCKED', other);
  v := pg_temp.t('Signed-out','A visitor cannot read orders','anon', $q$select count(*)::text from public.orders$q$, 'BLOCKED');
  v := pg_temp.t('Signed-out','A visitor cannot read the audit trail','anon', $q$select count(*)::text from public.audit_logs$q$, 'BLOCKED');
  v := pg_temp.t('Signed-out','A visitor cannot reverse a purchase','anon', format($q$select public.reverse_purchase(%L, 'visitor trying it')::text$q$, pur1), 'BLOCKED');
  v := pg_temp.t('Signed-out','A visitor cannot write an audit entry','anon', pg_temp.dml($q$insert into public.audit_logs (business_id, action) values ('demo-kitchen','forged')$q$), 'BLOCKED');

  -- ===== 10. WHAT THE TEST LEFT BEHIND (information) =====
  perform pg_temp.note('Result','Stock movements made in this test, by reason', coalesce((select string_agg(reason || ':' || n, ', ' order by reason) from (select reason, count(*) n from public.stock_movements where created_at = now() group by 1) s), 'none'));
  perform pg_temp.note('Result','Audit events made in this test', coalesce((select string_agg(action || ':' || n, ', ' order by action) from (select action, count(*) n from public.audit_logs where created_at = now() group by 1) s), 'none'));

  select count(*) filter (where ok is false), count(*) filter (where ok is true), count(*) filter (where outcome = 'TEST_ERROR') into n_fail, n_ok, n_err from pg_temp.rr;
  select string_agg(format('%s | %s | %s | %s | expect %s | %s%s | %s', n, area, step, role, expect, outcome, case when ok is false then '  <== FINDING' else '' end, detail), E'\n' order by n) into res from pg_temp.rr;
  raise exception E'REHEARSAL DONE. NOTHING WAS SAVED. passed=%, findings=%, test_errors=%\n%', n_ok, n_fail, n_err, res;
end $rehearsal$;
