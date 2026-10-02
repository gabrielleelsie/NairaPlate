-- NairaPlate Till price path, part A: cash and split sales through the database, and the old-version fix for credit and transfer.
-- Run once in the Supabase SQL editor, BEFORE the new Till code is released. Safe to re-run. Rollback: 20261015_till_price_a_rollback.sql
-- This part only adds and tightens functions. Nothing that works today stops working. Part B (later, after the release) closes the old direct write path.

-- 1. Cash, transfer (typed by staff, manual mode) and split sales. Prices come from the menu, never from the screen.
create or replace function public.create_cash_order(
  p_channel text, p_price_tier text, p_payment_method text, p_cash_kobo bigint, p_transfer_kobo bigint, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_total bigint := 0; v_price bigint; v_qty numeric; v_order uuid; it jsonb;
  v_cash bigint := coalesce(p_cash_kobo, 0); v_tr bigint := coalesce(p_transfer_kobo, 0);
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take orders.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_payment_method is null or p_payment_method not in ('cash','transfer','split') then raise exception 'Choose cash, transfer or split.'; end if;
  if length(btrim(coalesce(p_channel, ''))) < 1 then raise exception 'Choose where the order came from.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'No items.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Every item needs a quantity above zero.'; end if;
    select selling_price_kobo into v_price from public.recipes
     where id = (it->>'recipe_id')::uuid and business_id = v_biz and is_current;
    if not found then raise exception 'A dish in this order is not on your current menu.'; end if;
    v_total := v_total + round(v_price * v_qty);
  end loop;
  if v_total <= 0 then raise exception 'The total must be more than zero.'; end if;

  if v_cash < 0 or v_tr < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if v_cash + v_tr <> v_total then raise exception 'Cash and transfer must add up exactly to the total.'; end if;
  if p_payment_method = 'cash' and v_tr <> 0 then raise exception 'A cash sale has no transfer amount.'; end if;
  if p_payment_method = 'transfer' and v_cash <> 0 then raise exception 'A transfer sale has no cash amount.'; end if;
  if p_payment_method = 'split' and (v_cash <= 0 or v_tr <= 0) then raise exception 'A split sale needs both a cash and a transfer amount.'; end if;

  -- The payment-mode guard on orders still runs here (cash only, automatic, manual). It is not bypassed.
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by)
  values (v_biz, btrim(p_channel), p_price_tier, v_total, v_total, 'paid', p_payment_method, v_cash, v_tr, auth.uid())
  returning id into v_order;

  insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo)
  select v_biz, v_order, (x->>'recipe_id')::uuid, (x->>'quantity')::numeric, r.selling_price_kobo
    from jsonb_array_elements(p_items) x
    join public.recipes r on r.id = (x->>'recipe_id')::uuid and r.business_id = v_biz and r.is_current;

  return jsonb_build_object('order_id', v_order, 'total_kobo', v_total, 'cash_kobo', v_cash, 'transfer_kobo', v_tr, 'payment_method', p_payment_method);
end $function$;
revoke all on function public.create_cash_order(text, text, text, bigint, bigint, jsonb) from public, anon;
grant execute on function public.create_cash_order(text, text, text, bigint, bigint, jsonb) to authenticated, service_role;

-- 2. Credit sales: a dish must be a current version of this business's own menu.
create or replace function public.create_credit_order(p_channel text, p_price_tier text, p_customer_name text, p_phone text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_business text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_total bigint := 0; v_order uuid; v_credit uuid; it jsonb; v_price bigint;
begin
  if v_business is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take orders.'; end if;
  if coalesce(trim(p_customer_name), '') = '' or coalesce(trim(p_phone), '') = '' then raise exception 'Customer name and phone are required for credit.'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'No items.'; end if;

  -- Prices come from the database, not the screen (snapshot at sale time).
  for it in select * from jsonb_array_elements(p_items) loop
    if (it->>'quantity')::numeric is null or (it->>'quantity')::numeric <= 0 then raise exception 'Bad quantity.'; end if;
    select selling_price_kobo into v_price from recipes
     where id = (it->>'recipe_id')::uuid and business_id = v_business and is_current;
    if not found then raise exception 'Dish not found.'; end if;
    v_total := v_total + round(v_price * (it->>'quantity')::numeric);
  end loop;

  insert into orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by)
  values (v_business, p_channel, p_price_tier, v_total, v_total, 'paid', 'credit', 0, 0, auth.uid())
  returning id into v_order;

  insert into order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo)
  select v_business, v_order, (x->>'recipe_id')::uuid, (x->>'quantity')::numeric, r.selling_price_kobo
    from jsonb_array_elements(p_items) x
    join recipes r on r.id = (x->>'recipe_id')::uuid and r.business_id = v_business and r.is_current;

  insert into customer_credits (business_id, customer_name, phone, amount_kobo, settled, order_id)
  values (v_business, trim(p_customer_name), trim(p_phone), v_total, false, v_order)
  returning id into v_credit;

  return jsonb_build_object('order_id', v_order, 'credit_id', v_credit, 'total_kobo', v_total);
end;
$function$;
revoke all on function public.create_credit_order(text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_credit_order(text, text, text, text, jsonb) to authenticated, service_role;

-- 3. Automatic transfer orders: same current-version rule.
create or replace function public.create_transfer_order(p_channel text, p_price_tier text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  s public.business_payment_settings%rowtype;
  v_total bigint := 0; v_price bigint; v_order uuid; it jsonb; v_ref text; v_req uuid; v_exp timestamptz := now() + interval '10 minutes';
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take orders.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  select * into s from public.business_payment_settings where business_id = v_biz;
  if not found or s.mode <> 'automatic' or s.provider_status not in ('test','live') then
    raise exception 'Automatic transfers are not switched on for this shop.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'No items.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if (it->>'quantity')::numeric is null or (it->>'quantity')::numeric <= 0 then raise exception 'Bad quantity.'; end if;
    select selling_price_kobo into v_price from public.recipes where id = (it->>'recipe_id')::uuid and business_id = v_biz and is_current;
    if not found then raise exception 'Dish not found.'; end if;
    v_total := v_total + round(v_price * (it->>'quantity')::numeric);
  end loop;
  if v_total <= 0 then raise exception 'The total must be more than zero.'; end if;

  perform set_config('app.payment_internal', '1', true);
  insert into public.orders (business_id, channel, price_tier, subtotal_kobo, total_kobo, status, payment_method, cash_amount_kobo, transfer_amount_kobo, created_by)
  values (v_biz, p_channel, p_price_tier, v_total, v_total, 'awaiting_payment', 'transfer', 0, v_total, auth.uid())
  returning id into v_order;
  insert into public.order_items (business_id, order_id, recipe_id, quantity, unit_price_kobo)
  select v_biz, v_order, (x->>'recipe_id')::uuid, (x->>'quantity')::numeric, r.selling_price_kobo
    from jsonb_array_elements(p_items) x
    join public.recipes r on r.id = (x->>'recipe_id')::uuid and r.business_id = v_biz and r.is_current;
  perform set_config('app.payment_internal', '', true);

  v_ref := 'NP' || upper(replace(v_order::text, '-', ''));
  insert into public.payment_requests (business_id, order_id, provider, reference, amount_kobo, expires_at, created_by)
  values (v_biz, v_order, s.provider, v_ref, v_total, v_exp, auth.uid())
  returning id into v_req;
  return jsonb_build_object('order_id', v_order, 'request_id', v_req, 'reference', v_ref, 'amount_kobo', v_total, 'expires_at', v_exp, 'provider', s.provider, 'status', s.provider_status);
end $function$;
revoke all on function public.create_transfer_order(text, text, jsonb) from public, anon;
grant execute on function public.create_transfer_order(text, text, jsonb) to authenticated, service_role;
