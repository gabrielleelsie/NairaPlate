-- NairaPlate offline Phase 0, part A: a sale is saved once, even if the Till sends it twice.
-- Run once in the Supabase SQL editor BEFORE the new Till code is released. Safe to re-run.
-- Rollback: 20261030_sale_once_a_rollback.sql   Check: 20261030_sale_once_a_check.sql
--
-- What it does:
--   1. orders.client_sale_id: a code the Till makes for each sale attempt. Optional. Old orders keep it empty.
--   2. One business cannot have two orders with the same code. Two businesses may (codes are per business).
--   3. Three new "_once" sale functions. Each takes the code, and:
--        - if this business already has an order with that code, returns that same order (nothing new is written);
--        - otherwise calls the existing sale function unchanged and stamps the code on the new order.
--      The existing create_cash_order / create_credit_order / create_transfer_order are NOT changed.
--   4. find_sale_by_client_id: read-only. The Till's "Check again" asks whether a sale with that code was saved.
-- Nothing that works today stops working.

begin;

alter table public.orders add column if not exists client_sale_id uuid;

create unique index if not exists orders_business_client_sale_uniq
  on public.orders (business_id, client_sale_id) where client_sale_id is not null;

-- Shared: what to return for an order that already exists under this code.
create or replace function public.sale_once_existing(p_biz text, p_client_sale_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'order_id', o.id, 'total_kobo', o.total_kobo, 'cash_kobo', o.cash_amount_kobo, 'transfer_kobo', o.transfer_amount_kobo,
    'payment_method', o.payment_method, 'status', o.status, 'created_at', o.created_at, 'already_saved', true,
    'request_id', (select pr.id from public.payment_requests pr where pr.order_id = o.id order by pr.created_at desc limit 1),
    'amount_kobo', o.total_kobo,
    'credit_id', (select c.id from public.customer_credits c where c.order_id = o.id limit 1))
  from public.orders o
  where o.business_id = p_biz and o.client_sale_id = p_client_sale_id
$function$;
revoke all on function public.sale_once_existing(text, uuid) from public, anon, authenticated;
grant execute on function public.sale_once_existing(text, uuid) to service_role;

-- Shared: stamp the code on the order just created (inside the same transaction as the sale).
create or replace function public.sale_once_stamp(p_biz text, p_order uuid, p_client_sale_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform set_config('app.payment_internal', '1', true);
  update public.orders set client_sale_id = p_client_sale_id
   where id = p_order and business_id = p_biz and client_sale_id is null;
  perform set_config('app.payment_internal', '', true);
  if not found then raise exception 'The sale could not be marked as saved once.'; end if;
end $function$;
revoke all on function public.sale_once_stamp(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.sale_once_stamp(text, uuid, uuid) to service_role;

-- Cash, manual transfer and split.
create or replace function public.create_cash_order_once(
  p_client_sale_id uuid, p_channel text, p_price_tier text, p_payment_method text, p_cash_kobo bigint, p_transfer_kobo bigint, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_res jsonb;
begin
  if v_biz is null then raise exception 'Only cashiers and owners can take orders.'; end if;
  if p_client_sale_id is null then raise exception 'This sale has no reference. Refresh the Till and try again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_biz || ':' || p_client_sale_id::text, 0));
  v_res := public.sale_once_existing(v_biz, p_client_sale_id);
  if v_res is not null then return v_res; end if;
  v_res := public.create_cash_order(p_channel, p_price_tier, p_payment_method, p_cash_kobo, p_transfer_kobo, p_items);
  perform public.sale_once_stamp(v_biz, (v_res->>'order_id')::uuid, p_client_sale_id);
  return v_res || jsonb_build_object('already_saved', false);
end $function$;
revoke all on function public.create_cash_order_once(uuid, text, text, text, bigint, bigint, jsonb) from public, anon;
grant execute on function public.create_cash_order_once(uuid, text, text, text, bigint, bigint, jsonb) to authenticated, service_role;

-- Credit.
create or replace function public.create_credit_order_once(
  p_client_sale_id uuid, p_channel text, p_price_tier text, p_customer_name text, p_phone text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_res jsonb;
begin
  if v_biz is null then raise exception 'Only cashiers and owners can take orders.'; end if;
  if p_client_sale_id is null then raise exception 'This sale has no reference. Refresh the Till and try again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_biz || ':' || p_client_sale_id::text, 0));
  v_res := public.sale_once_existing(v_biz, p_client_sale_id);
  if v_res is not null then return v_res; end if;
  v_res := public.create_credit_order(p_channel, p_price_tier, p_customer_name, p_phone, p_items);
  perform public.sale_once_stamp(v_biz, (v_res->>'order_id')::uuid, p_client_sale_id);
  return v_res || jsonb_build_object('already_saved', false);
end $function$;
revoke all on function public.create_credit_order_once(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_credit_order_once(uuid, text, text, text, text, jsonb) to authenticated, service_role;

-- Automatic transfer.
create or replace function public.create_transfer_order_once(
  p_client_sale_id uuid, p_channel text, p_price_tier text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id'; v_res jsonb;
begin
  if v_biz is null then raise exception 'Only cashiers and owners can take orders.'; end if;
  if p_client_sale_id is null then raise exception 'This sale has no reference. Refresh the Till and try again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_biz || ':' || p_client_sale_id::text, 0));
  v_res := public.sale_once_existing(v_biz, p_client_sale_id);
  if v_res is not null then return v_res; end if;
  v_res := public.create_transfer_order(p_channel, p_price_tier, p_items);
  perform public.sale_once_stamp(v_biz, (v_res->>'order_id')::uuid, p_client_sale_id);
  return v_res || jsonb_build_object('already_saved', false);
end $function$;
revoke all on function public.create_transfer_order_once(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_transfer_order_once(uuid, text, text, jsonb) to authenticated, service_role;

-- Read-only lookup for "Check again". Only this business's own orders, only staff who can take orders.
create or replace function public.find_sale_by_client_id(p_client_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_res jsonb;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can check sales.'; end if;
  v_res := public.sale_once_existing(v_biz, p_client_sale_id);
  return coalesce(v_res, jsonb_build_object('found', false)) || case when v_res is null then '{}'::jsonb else jsonb_build_object('found', true) end;
end $function$;
revoke all on function public.find_sale_by_client_id(uuid) from public, anon;
grant execute on function public.find_sale_by_client_id(uuid) to authenticated, service_role;

commit;
