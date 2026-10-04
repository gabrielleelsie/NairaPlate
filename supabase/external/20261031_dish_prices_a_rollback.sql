-- Undo for 20261031_dish_prices_a.sql. Removes price history and puts the three *_once sale functions back as they were.
-- Today's prices on recipes are not touched. Run in the Supabase SQL editor (clear editor, paste all, no selection, Run).
begin;
drop trigger if exists order_items_set_dish_price on public.order_items;
drop function if exists public.order_items_set_dish_price();
alter table public.order_items drop column if exists dish_price_id;
drop trigger if exists recipes_record_price on public.recipes;
drop function if exists public.recipes_record_price();
drop function if exists public.cancel_dish_price(uuid);
drop function if exists public.set_dish_price(uuid, bigint, timestamptz);
drop function if exists public.refresh_dish_prices();

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


drop function if exists public.apply_due_dish_prices(text);
drop function if exists public.dish_price_at(uuid, timestamptz);
drop view if exists public.dish_price_periods;
drop table if exists public.dish_prices;
drop function if exists public.dish_prices_protect();
commit;
