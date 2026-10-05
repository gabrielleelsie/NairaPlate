-- NairaPlate Step 2 (before Phase 1 late entry): dish selling-price history.
-- Run once in the Supabase SQL editor BEFORE the new code is released. Safe to re-run.
-- Check: 20261031_dish_prices_a_check.sql   Rollback: 20261031_dish_prices_a_rollback.sql
--
-- What it does:
--   1. dish_prices: one add-only row per price a dish has had or will have. A price runs from its start until the next price starts,
--      so periods can never overlap or leave a gap. Started rows can never be edited or deleted. A scheduled row may only be cancelled
--      before it starts. History begins today: each current dish gets one row starting now. Older sales keep the price on their own lines.
--   2. dish_price_at(dish, time): the price that applied to a dish at any moment. Phase 1 late entry will use it.
--   3. set_dish_price / cancel_dish_price: owner or Supa Admin only, plan must be active. A price starts now or at a future time.
--   4. Every existing way a price changes (recipe save, pricing approval, owner corrections) is recorded automatically by a rule on
--      recipes, so history can never go stale. recipes.selling_price_kobo stays as the copy of today's price that screens read.
--   5. When a scheduled price starts, the copy is updated the first time a sale or Till/Recipes screen touches the business.
--      The three *_once sale functions do this before charging. Each order line records which price row it used.
--   6. Audit lines: dish_price_scheduled, dish_price_started, dish_price_cancelled.
-- The existing create_cash_order / create_credit_order / create_transfer_order are NOT changed.

begin;

create extension if not exists btree_gist;

create table if not exists public.dish_prices (
  id             uuid        primary key default gen_random_uuid(),
  business_id    text        not null references public.businesses(id) on delete cascade,
  dish_id        uuid        not null,
  price_kobo     bigint      not null check (price_kobo > 0),
  effective_from timestamptz not null,
  source         text        not null check (source in ('backfill','owner','recipe_change')),
  set_by         uuid,
  set_by_name    text,
  applied_at     timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  created_at     timestamptz not null default now()
);
create unique index if not exists dish_prices_one_start on public.dish_prices (dish_id, effective_from) where cancelled_at is null;
create index if not exists dish_prices_business_idx on public.dish_prices (business_id, dish_id, effective_from desc);

revoke all on public.dish_prices from anon, authenticated;
grant select on public.dish_prices to authenticated;
grant all on public.dish_prices to service_role;
alter table public.dish_prices enable row level security;
drop policy if exists dish_prices_select on public.dish_prices;
create policy dish_prices_select on public.dish_prices for select to authenticated
  using (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') and public.business_has_access(business_id));

-- Add-only: no direct inserts from the browser; started rows frozen; only cancel (future rows) and applied_at may change; never deleted.
create or replace function public.dish_prices_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if TG_OP = 'INSERT' then
    if current_user in ('authenticated','anon') then raise exception 'Prices are set through the Recipes screen only.'; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then raise exception 'Price history cannot be deleted.'; end if;
  if NEW.id <> OLD.id or NEW.business_id <> OLD.business_id or NEW.dish_id <> OLD.dish_id or NEW.price_kobo <> OLD.price_kobo
     or NEW.effective_from <> OLD.effective_from or NEW.source <> OLD.source or NEW.set_by is distinct from OLD.set_by
     or NEW.set_by_name is distinct from OLD.set_by_name or NEW.created_at <> OLD.created_at then
    raise exception 'Price history cannot be edited. Set a new price instead.';
  end if;
  if NEW.cancelled_at is distinct from OLD.cancelled_at then
    if OLD.cancelled_at is not null or OLD.effective_from <= now() or OLD.applied_at is not null then
      raise exception 'Only a scheduled price that has not started can be cancelled.';
    end if;
  end if;
  if OLD.applied_at is not null and NEW.applied_at is distinct from OLD.applied_at then
    raise exception 'Price history cannot be edited.';
  end if;
  return NEW;
end $function$;
revoke all on function public.dish_prices_protect() from public, anon, authenticated;
drop trigger if exists dish_prices_protect on public.dish_prices;
create trigger dish_prices_protect before insert or update or delete on public.dish_prices
  for each row execute function public.dish_prices_protect();

-- Start and end of each price, for screens.
create or replace view public.dish_price_periods with (security_invoker = true) as
  select p.*, lead(p.effective_from) over (partition by p.dish_id order by p.effective_from) as effective_to
  from public.dish_prices p where p.cancelled_at is null;
grant select on public.dish_price_periods to authenticated, service_role;

-- The price row that applied to a dish at a moment. Reads through RLS (own business only) for signed-in staff.
create or replace function public.dish_price_at(p_dish uuid, p_at timestamptz)
returns table (id uuid, price_kobo bigint, effective_from timestamptz)
language sql stable set search_path to 'public' as $function$
  select p.id, p.price_kobo, p.effective_from from public.dish_prices p
  where p.dish_id = p_dish and p.cancelled_at is null and p.effective_from <= p_at
  order by p.effective_from desc limit 1
$function$;
revoke all on function public.dish_price_at(uuid, timestamptz) from public, anon;
grant execute on function public.dish_price_at(uuid, timestamptz) to authenticated, service_role;

-- Internal: copy any price that has started onto the current recipe rows; audit the start once.
create or replace function public.apply_due_dish_prices(p_biz text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_n integer := 0; r record;
begin
  for r in
    select p.id, p.dish_id, p.price_kobo, p.effective_from, p.source from public.dish_prices p
    where p.business_id = p_biz and p.cancelled_at is null and p.applied_at is null and p.effective_from <= now()
    order by p.effective_from
  loop
    -- Only the newest started row for the dish is copied; older unapplied rows are just marked.
    if r.id = (select x.id from public.dish_price_at(r.dish_id, now()) x) then
      perform set_config('app.price_mirror', '1', true);
      update public.recipes set selling_price_kobo = r.price_kobo
       where business_id = p_biz and dish_id = r.dish_id and is_current and selling_price_kobo <> r.price_kobo;
      perform set_config('app.price_mirror', '', true);
    end if;
    update public.dish_prices set applied_at = now() where id = r.id;
    if r.source = 'owner' then
      insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
      values (p_biz, null, 'system', 'dish_price_started', 'dish_prices', r.id,
        format('Price ₦%s started for %s', to_char(r.price_kobo / 100.0, 'FM999,999,990.00'),
               coalesce((select name from public.recipes where dish_id = r.dish_id and is_current limit 1), 'a dish')));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
revoke all on function public.apply_due_dish_prices(text) from public, anon, authenticated;
grant execute on function public.apply_due_dish_prices(text) to service_role;

-- Screens call this on load so a scheduled price shows once it has started.
create or replace function public.refresh_dish_prices()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id';
begin
  if auth.uid() is null or v_biz is null or not public.business_has_access(v_biz) then return 0; end if;
  return public.apply_due_dish_prices(v_biz);
end $function$;
revoke all on function public.refresh_dish_prices() from public, anon;
grant execute on function public.refresh_dish_prices() to authenticated, service_role;

-- Owner sets a price now (p_from null or in the past minute) or schedules one for later.
create or replace function public.set_dish_price(p_dish uuid, p_price_kobo bigint, p_from timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; v_from timestamptz; v_id uuid; v_dish_name text; v_now boolean;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can set dish prices.'; end if;
  if not public.business_has_access(v_biz) then raise exception 'Your NairaPlate plan has ended.'; end if;
  if p_price_kobo is null or p_price_kobo <= 0 then raise exception 'Price must be more than zero.'; end if;
  select name into v_dish_name from public.recipes where business_id = v_biz and dish_id = p_dish and is_current limit 1;
  if v_dish_name is null then raise exception 'Dish not found.'; end if;
  if p_from is not null and p_from < now() - interval '1 minute' then raise exception 'A new price cannot start in the past.'; end if;
  v_now  := p_from is null or p_from <= now();
  v_from := case when v_now then now() else p_from end;
  if exists (select 1 from public.dish_prices where dish_id = p_dish and effective_from = v_from and cancelled_at is null) then
    raise exception 'Another price already starts at that time.';
  end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.dish_prices (business_id, dish_id, price_kobo, effective_from, source, set_by, set_by_name)
  values (v_biz, p_dish, p_price_kobo, v_from, 'owner', auth.uid(), coalesce(v_name, 'Owner')) returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, case when v_now then 'dish_price_started' else 'dish_price_scheduled' end, 'dish_prices', v_id,
    format('%s: ₦%s %s', v_dish_name, to_char(p_price_kobo / 100.0, 'FM999,999,990.00'),
           case when v_now then 'from now' else 'from ' || to_char(v_from at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' (Lagos)' end));
  if v_now then
    perform set_config('app.price_mirror', '1', true);
    update public.recipes set selling_price_kobo = p_price_kobo where business_id = v_biz and dish_id = p_dish and is_current;
    perform set_config('app.price_mirror', '', true);
    update public.dish_prices set applied_at = now() where id = v_id;
  end if;
  return v_id;
end $function$;
revoke all on function public.set_dish_price(uuid, bigint, timestamptz) from public, anon;
grant execute on function public.set_dish_price(uuid, bigint, timestamptz) to authenticated, service_role;

create or replace function public.cancel_dish_price(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  p public.dish_prices;
begin
  if auth.uid() is null or v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can cancel a scheduled price.'; end if;
  if not public.business_has_access(v_biz) then raise exception 'Your NairaPlate plan has ended.'; end if;
  select * into p from public.dish_prices where id = p_id and business_id = v_biz for update;
  if not found then raise exception 'Price not found.'; end if;
  update public.dish_prices set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'dish_price_cancelled', 'dish_prices', p_id,
    format('Cancelled ₦%s due %s (Lagos)', to_char(p.price_kobo / 100.0, 'FM999,999,990.00'),
           to_char(p.effective_from at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI')));
end $function$;
revoke all on function public.cancel_dish_price(uuid) from public, anon;
grant execute on function public.cancel_dish_price(uuid) to authenticated, service_role;

-- History begins today: one row per current dish, starting now.
insert into public.dish_prices (business_id, dish_id, price_kobo, effective_from, source, set_by_name, applied_at)
select distinct on (r.dish_id) r.business_id, r.dish_id, r.selling_price_kobo, now(), 'backfill', 'Starting price', now()
from public.recipes r
where r.is_current and r.dish_id is not null and r.selling_price_kobo > 0
  and not exists (select 1 from public.dish_prices p where p.dish_id = r.dish_id)
order by r.dish_id, r.version_number desc;

-- Any other price change (recipe save, pricing approval, owner corrections, new dish) is recorded as starting now.
create or replace function public.recipes_record_price()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_cur bigint; v_name text; v_id uuid;
begin
  if coalesce(current_setting('app.price_mirror', true), '') = '1' then return NEW; end if;
  if not NEW.is_current or NEW.dish_id is null or NEW.selling_price_kobo is null or NEW.selling_price_kobo <= 0 then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.selling_price_kobo is not distinct from OLD.selling_price_kobo then return NEW; end if;
  select x.price_kobo into v_cur from public.dish_price_at(NEW.dish_id, now()) x;
  if v_cur is not distinct from NEW.selling_price_kobo then return NEW; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.dish_prices (business_id, dish_id, price_kobo, effective_from, source, set_by, set_by_name, applied_at)
  values (NEW.business_id, NEW.dish_id, NEW.selling_price_kobo,
          greatest(now(), coalesce((select max(effective_from) + interval '1 microsecond' from public.dish_prices
                                     where dish_id = NEW.dish_id and cancelled_at is null and effective_from <= now()), now())),
          'recipe_change', auth.uid(), coalesce(v_name, 'System'), now())
  returning id into v_id;
  return NEW;
end $function$;
revoke all on function public.recipes_record_price() from public, anon, authenticated;
drop trigger if exists recipes_record_price on public.recipes;
create trigger recipes_record_price after insert or update of selling_price_kobo, is_current on public.recipes
  for each row execute function public.recipes_record_price();

-- Each order line records the price row it used.
alter table public.order_items add column if not exists dish_price_id uuid references public.dish_prices(id) on delete restrict;
create or replace function public.order_items_set_dish_price()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if NEW.dish_price_id is null then
    select x.id into NEW.dish_price_id
    from public.recipes r cross join lateral public.dish_price_at(r.dish_id, coalesce(NEW.created_at, now())) x
    where r.id = NEW.recipe_id;
  end if;
  return NEW;
end $function$;
revoke all on function public.order_items_set_dish_price() from public, anon, authenticated;
drop trigger if exists order_items_set_dish_price on public.order_items;
create trigger order_items_set_dish_price before insert on public.order_items
  for each row execute function public.order_items_set_dish_price();

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
  perform public.apply_due_dish_prices(v_biz);  -- a scheduled price that has started is charged from its start time
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
  perform public.apply_due_dish_prices(v_biz);  -- a scheduled price that has started is charged from its start time
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
  perform public.apply_due_dish_prices(v_biz);  -- a scheduled price that has started is charged from its start time
  v_res := public.create_transfer_order(p_channel, p_price_tier, p_items);
  perform public.sale_once_stamp(v_biz, (v_res->>'order_id')::uuid, p_client_sale_id);
  return v_res || jsonb_build_object('already_saved', false);
end $function$;
revoke all on function public.create_transfer_order_once(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_transfer_order_once(uuid, text, text, jsonb) to authenticated, service_role;


-- Safety: every current dish must have a starting price.
do $$
declare v_missing integer;
begin
  select count(*) into v_missing from (select distinct dish_id from public.recipes where is_current and dish_id is not null and selling_price_kobo > 0) d
  where not exists (select 1 from public.dish_prices p where p.dish_id = d.dish_id and p.cancelled_at is null);
  if v_missing > 0 then raise exception 'Stopped: % dishes have no starting price. Nothing was saved.', v_missing; end if;
end $$;

commit;
