-- NairaPlate catering step 2a: a per-business catering switch, orders built from the menu, and order status.
-- Run once in the Supabase SQL editor, after 20261013_catering_reminders.sql. Safe to re-run. Rollback: 20261014_catering_2a_rollback.sql
-- Nothing changes for a business unless catering is switched on for it. Businesses that already have bookings are switched on.

-- 1. Per-business feature switch. Off unless a row says on. Server and platform admin write it; staff can only read their own business's.
create table if not exists public.business_features (
  business_id     text        not null references public.businesses(id) on delete cascade,
  feature         text        not null check (feature in ('catering')),
  enabled         boolean     not null default false,
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (business_id, feature)
);
alter table public.business_features enable row level security;
drop policy if exists business_features_select on public.business_features;
create policy business_features_select on public.business_features for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id'));
revoke all on public.business_features from anon, authenticated;
grant select on public.business_features to authenticated;
grant all on public.business_features to service_role;

-- Anyone who already has catering bookings keeps catering.
insert into public.business_features (business_id, feature, enabled, updated_by_name)
select distinct c.business_id, 'catering', true, 'Switched on automatically: has bookings' from public.catering_deposits c
on conflict (business_id, feature) do nothing;

create or replace function public.catering_enabled(p_business_id text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select enabled from public.business_features where business_id = p_business_id and feature = 'catering'), false)
$function$;
revoke all on function public.catering_enabled(text) from public, anon;
grant execute on function public.catering_enabled(text) to authenticated, service_role;

-- 2. More about each order. Past orders that already exist are marked delivered, the rest confirmed (done once, when the column is first added).
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_deposits' and column_name = 'status') then
    alter table public.catering_deposits
      add column status text not null default 'confirmed',
      add column delivery_address text,
      add column notes text,
      add column delivery_fee_kobo bigint not null default 0,
      add column discount_kobo bigint not null default 0,
      add column subtotal_kobo bigint not null default 0;
    alter table public.catering_deposits add constraint catering_deposits_status_check check (status in ('enquiry','confirmed','delivered','cancelled'));
    update public.catering_deposits set status = 'delivered' where event_date is not null and event_date < (now() at time zone 'Africa/Lagos')::date;
  end if;
end $$;

-- 3. The lines of an order. The price is saved when the order is made, so later menu changes never alter it.
create table if not exists public.catering_order_items (
  id              uuid        primary key default gen_random_uuid(),
  business_id     text        not null references public.businesses(id) on delete cascade,
  order_id        uuid        not null references public.catering_deposits(id) on delete cascade,
  recipe_id       uuid,
  recipe_name     text        not null,
  quantity        numeric     not null check (quantity > 0),
  unit_price_kobo bigint      not null check (unit_price_kobo >= 0),
  line_total_kobo bigint      not null,
  is_custom       boolean     not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists catering_order_items_order_idx on public.catering_order_items (order_id);
alter table public.catering_order_items enable row level security;
drop policy if exists catering_order_items_select on public.catering_order_items;
create policy catering_order_items_select on public.catering_order_items for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier','purchaser','cook'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.catering_order_items from anon, authenticated;
grant select on public.catering_order_items to authenticated;
grant all on public.catering_order_items to service_role;

-- 4. Make an order. Prices for menu dishes come from the database, not the screen. Rules:
--    cashiers and owners may take orders; only an owner may add a line that is not on the menu, or give a discount.
create or replace function public.create_catering_order(
  p_customer text, p_phone text, p_event_date date, p_event_time time, p_address text, p_notes text,
  p_items jsonb, p_delivery_fee_kobo bigint, p_discount_kobo bigint, p_deposit_kobo bigint, p_status text default 'confirmed')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; v_today date := (now() at time zone 'Africa/Lagos')::date;
  it jsonb; v_qty numeric; v_price bigint; v_dish text; v_rid uuid; v_sub bigint := 0; v_total bigint; v_line bigint;
  v_id uuid; v_summary text := ''; v_fee bigint := coalesce(p_delivery_fee_kobo, 0); v_disc bigint := coalesce(p_discount_kobo, 0); v_dep bigint := coalesce(p_deposit_kobo, 0);
  v_lines jsonb := '[]'::jsonb;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can take catering orders.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if not public.catering_enabled(v_biz) then raise exception 'Catering orders are not switched on for this business.'; end if;
  if length(btrim(coalesce(p_customer, ''))) < 1 then raise exception 'Enter the customer name.'; end if;
  if p_event_date is null or p_event_time is null then raise exception 'Enter the event date and time.'; end if;
  if p_event_date < v_today then raise exception 'That date has already passed.'; end if;
  if p_status not in ('enquiry','confirmed') then raise exception 'A new order is an enquiry or confirmed.'; end if;
  if v_fee < 0 or v_disc < 0 or v_dep < 0 then raise exception 'Amounts cannot be negative.'; end if;
  if v_disc > 0 and v_role not in ('owner','supa_admin') then raise exception 'Only an owner can give a discount.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Every item needs a quantity above zero.'; end if;
    if nullif(it->>'recipe_id', '') is not null then
      v_rid := (it->>'recipe_id')::uuid;
      select name, selling_price_kobo into v_dish, v_price from public.recipes where id = v_rid and business_id = v_biz and is_current;
      if not found then raise exception 'A dish in this order was not found on your menu.'; end if;
      v_lines := v_lines || jsonb_build_object('recipe_id', v_rid, 'name', v_dish, 'qty', v_qty, 'price', v_price, 'custom', false);
    else
      if v_role not in ('owner','supa_admin') then raise exception 'Only an owner can add an item that is not on the menu.'; end if;
      v_dish := btrim(coalesce(it->>'name', ''));
      v_price := (it->>'unit_price_kobo')::bigint;
      if v_dish = '' or v_price is null or v_price < 0 then raise exception 'A custom item needs a name and a price.'; end if;
      v_lines := v_lines || jsonb_build_object('recipe_id', null, 'name', v_dish, 'qty', v_qty, 'price', v_price, 'custom', true);
    end if;
    v_sub := v_sub + round(v_price * v_qty);
  end loop;

  if v_disc > v_sub then raise exception 'The discount cannot be more than the items total.'; end if;
  v_total := v_sub + v_fee - v_disc;
  if v_total <= 0 then raise exception 'The order total must be more than zero.'; end if;
  if v_dep > v_total then raise exception 'The deposit cannot be more than the order total.'; end if;

  for it in select * from jsonb_array_elements(v_lines) loop
    v_summary := v_summary || case when v_summary = '' then '' else ', ' end
              || case when (it->>'qty')::numeric = trunc((it->>'qty')::numeric) then trunc((it->>'qty')::numeric)::text else (it->>'qty') end || ' x ' || (it->>'name');
  end loop;

  insert into public.catering_deposits (business_id, customer_name, phone, event_date, event_time, total_contract_kobo, deposit_kobo, items_summary, settled,
                                        status, delivery_address, notes, delivery_fee_kobo, discount_kobo, subtotal_kobo)
  values (v_biz, btrim(p_customer), nullif(btrim(coalesce(p_phone, '')), ''), p_event_date, p_event_time, v_total, v_dep, v_summary, v_dep >= v_total,
          p_status, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), v_fee, v_disc, v_sub)
  returning id into v_id;

  insert into public.catering_order_items (business_id, order_id, recipe_id, recipe_name, quantity, unit_price_kobo, line_total_kobo, is_custom)
  select v_biz, v_id, nullif(l->>'recipe_id', '')::uuid, l->>'name', (l->>'qty')::numeric, (l->>'price')::bigint, round((l->>'price')::bigint * (l->>'qty')::numeric), (l->>'custom')::boolean
    from jsonb_array_elements(v_lines) l;

  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_order_created', 'catering_deposits', v_id,
          format('%s took a catering order for %s on %s: %s kobo, deposit %s kobo', coalesce(v_name, 'Staff'), btrim(p_customer), p_event_date, v_total, v_dep));
  return jsonb_build_object('id', v_id, 'subtotal_kobo', v_sub, 'total_kobo', v_total, 'deposit_kobo', v_dep, 'balance_kobo', v_total - v_dep, 'summary', v_summary);
end $function$;
revoke all on function public.create_catering_order(text, text, date, time, text, text, jsonb, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.create_catering_order(text, text, date, time, text, text, jsonb, bigint, bigint, bigint, text) to authenticated, service_role;

-- 5. Change an order's status. enquiry -> confirmed or cancelled. confirmed -> delivered or cancelled. Delivered and cancelled are final.
--    Cashiers and owners can confirm and deliver; only an owner can cancel.
create or replace function public.set_catering_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; o public.catering_deposits%rowtype;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can change an order.'; end if;
  select * into o from public.catering_deposits where id = p_order_id and business_id = v_biz for update;
  if not found then raise exception 'Order not found.'; end if;
  if p_status not in ('confirmed','delivered','cancelled') then raise exception 'Unknown status.'; end if;
  if not ((o.status = 'enquiry' and p_status in ('confirmed','cancelled')) or (o.status = 'confirmed' and p_status in ('delivered','cancelled'))) then
    raise exception 'An order that is % cannot be changed to %.', o.status, p_status;
  end if;
  if p_status = 'cancelled' and v_role not in ('owner','supa_admin') then raise exception 'Only an owner can cancel an order.'; end if;
  update public.catering_deposits set status = p_status where id = o.id;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_order_' || p_status, 'catering_deposits', o.id, format('%s marked the order for %s as %s', coalesce(v_name, 'Staff'), o.customer_name, p_status));
  return jsonb_build_object('id', o.id, 'status', p_status);
end $function$;
revoke all on function public.set_catering_status(uuid, text) from public, anon;
grant execute on function public.set_catering_status(uuid, text) to authenticated, service_role;

-- 6. Owner alerts now skip orders that are only enquiries, delivered or cancelled, and businesses with catering switched off.
create or replace function public.raise_catering_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  b record; v_bal bigint; v_ref text; v_when text; v_days int; v_n int := 0; v_msg text;
begin
  for b in
    select c.*, (c.total_contract_kobo - c.deposit_kobo - coalesce(c.additional_payments_kobo, 0)) as balance
      from public.catering_deposits c
      join public.businesses biz on biz.id = c.business_id and biz.status = 'approved'
      join public.business_features f on f.business_id = c.business_id and f.feature = 'catering' and f.enabled
     where c.status = 'confirmed' and c.event_date between v_today and v_today + 3
  loop
    v_bal := b.balance;
    v_days := b.event_date - v_today;
    v_ref := ' (ref ' || left(replace(b.id::text, '-', ''), 12) || ')';
    v_when := to_char(b.event_date, 'FMDay FMDD FMMonth') || case when b.event_time is not null then ' at ' || to_char(b.event_time, 'FMHH12:MI am') else '' end;

    if v_days <= 1 then
      v_msg := 'Catering order for ' || b.customer_name || ' is ' || case when v_days = 0 then 'today' else 'tomorrow' end || ': ' || v_when || '. '
               || case when v_bal > 0 and not b.settled then '₦' || to_char(v_bal / 100.0, 'FM999,999,990.00') || ' is still unpaid.' else 'It is fully paid.' end || v_ref;
      if not exists (select 1 from public.margin_flags where business_id = b.business_id and flag_type = 'catering_due' and role = 'owner' and created_at > now() - interval '2 days' and right(message, length(v_ref)) = v_ref and message like '%' || case when v_days = 0 then 'is today' else 'is tomorrow' end || '%') then
        insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
        values (b.business_id, 'catering_due', 'warn', v_msg, 'owner', false);
        v_n := v_n + 1;
      end if;
    end if;

    if v_bal > 0 and not b.settled then
      v_msg := 'Catering order for ' || b.customer_name || ' on ' || v_when || ' is ' || case when v_days = 0 then 'today' when v_days = 1 then 'tomorrow' else 'in ' || v_days || ' days' end
               || ' and ₦' || to_char(v_bal / 100.0, 'FM999,999,990.00') || ' is still unpaid.' || v_ref;
      if not exists (select 1 from public.margin_flags where business_id = b.business_id and flag_type = 'catering_balance' and role = 'owner' and created_at > now() - interval '4 days' and right(message, length(v_ref)) = v_ref) then
        insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
        values (b.business_id, 'catering_balance', 'critical', v_msg, 'owner', false);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $function$;
revoke all on function public.raise_catering_alerts() from public, anon, authenticated;
grant execute on function public.raise_catering_alerts() to service_role;
