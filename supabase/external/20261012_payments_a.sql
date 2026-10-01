-- NairaPlate automatic transfer confirmation, part A: settings, tables, and the rule that only the bank's message can mark a transfer order Paid.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261012_payments_a_rollback.sql
-- Nothing changes for any shop until its owner chooses a payment mode: shops with no setting stay on "manual" (today's behaviour).

-- 1. Per-shop payment setting. mode: manual (today), cash_only (transfers switched off), automatic (transfers only through the bank link).
create table if not exists public.business_payment_settings (
  business_id      text primary key references public.businesses(id) on delete cascade,
  mode             text not null default 'manual' check (mode in ('manual','cash_only','automatic')),
  provider         text check (provider in ('monnify','opay')),
  provider_status  text not null default 'not_connected' check (provider_status in ('not_connected','test','live')),
  contract_code    text,
  api_key_secret_id    uuid,   -- the keys themselves live in the database vault, never in this table
  secret_key_secret_id uuid,
  connected_at     timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
alter table public.business_payment_settings enable row level security;
drop policy if exists business_payment_settings_select on public.business_payment_settings;
create policy business_payment_settings_select on public.business_payment_settings for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.business_payment_settings from anon, authenticated;
grant select (business_id, mode, provider, provider_status, connected_at) on public.business_payment_settings to authenticated;
grant all on public.business_payment_settings to service_role;

-- 2. One payment request per transfer order.
create table if not exists public.payment_requests (
  id               uuid primary key default gen_random_uuid(),
  business_id      text not null references public.businesses(id) on delete cascade,
  order_id         uuid not null unique references public.orders(id) on delete cascade,
  provider         text not null default 'monnify',
  reference        text not null unique,
  amount_kobo      bigint not null check (amount_kobo > 0),
  status           text not null default 'waiting' check (status in ('waiting','paid','short','cancelled')),
  account_number   text,
  bank_name        text,
  account_name     text,
  expires_at       timestamptz not null,
  paid_amount_kobo bigint,
  paid_at          timestamptz,
  provider_ref     text,
  cancel_reason    text,
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create index if not exists payment_requests_biz_idx on public.payment_requests (business_id, created_at desc);
alter table public.payment_requests enable row level security;
drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select on public.payment_requests for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;
grant all on public.payment_requests to service_role;

-- 3. Every message received from a provider, kept as it arrived. Server only. The same event is never applied twice.
create table if not exists public.payment_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  event_id      text not null,
  business_id   text,
  reference     text,
  amount_kobo   bigint,
  outcome       text not null default 'received',
  raw           jsonb,
  created_at    timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
grant all on public.payment_events to service_role;

-- 4. A new order status: waiting for the bank.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%partially_refunded%' loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
end $$;
alter table public.orders add constraint orders_status_check_v2
  check (status in ('draft','paid','cancelled','refunded','partially_refunded','awaiting_payment'));

-- 5. The shop's current mode (no row = manual).
create or replace function public.payment_mode_of(p_business_id text)
returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select mode from public.business_payment_settings where business_id = p_business_id), 'manual')
$function$;
revoke all on function public.payment_mode_of(text) from public, anon;
grant execute on function public.payment_mode_of(text) to authenticated, service_role;

-- 6. The rule. Staff sessions cannot take a transfer outside the allowed route, cannot mark a waiting order Paid, and cannot edit one.
-- The bank's message arrives through the server (service key, no staff login), and the payment functions below set app.payment_internal.
create or replace function public.orders_payment_guard()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_mode text;
begin
  if auth.uid() is null or current_setting('app.payment_internal', true) = '1' then return NEW; end if;
  v_mode := public.payment_mode_of(NEW.business_id);
  if TG_OP = 'INSERT' then
    if NEW.status = 'awaiting_payment' then
      raise exception 'Orders waiting for the bank can only be created by "Pay by transfer (automatic)".';
    end if;
    if v_mode = 'cash_only' and (NEW.payment_method in ('transfer','split') or NEW.transfer_amount_kobo > 0) then
      raise exception 'This shop takes cash and credit only. Transfers are switched off.';
    end if;
    if v_mode = 'automatic' and (NEW.payment_method in ('transfer','split') or NEW.transfer_amount_kobo > 0) then
      raise exception 'Transfers are confirmed automatically by the bank. Use "Pay by transfer (automatic)".';
    end if;
    return NEW;
  end if;
  if OLD.status = 'awaiting_payment' then
    raise exception 'This order is waiting for the bank. It becomes Paid when the money arrives, or it can be cancelled with a reason.';
  end if;
  if NEW.status = 'awaiting_payment' then
    raise exception 'An order cannot be changed back to waiting for the bank.';
  end if;
  if v_mode in ('cash_only','automatic') and (
       NEW.payment_method is distinct from OLD.payment_method
    or NEW.transfer_amount_kobo is distinct from OLD.transfer_amount_kobo
    or NEW.cash_amount_kobo is distinct from OLD.cash_amount_kobo
    or NEW.total_kobo is distinct from OLD.total_kobo) then
    raise exception 'How a sale was paid cannot be changed once it is saved.';
  end if;
  return NEW;
end $function$;
drop trigger if exists orders_payment_guard on public.orders;
create trigger orders_payment_guard before insert or update on public.orders
  for each row execute function public.orders_payment_guard();

-- 7. The owner picks the mode. "automatic" needs a connected provider.
create or replace function public.set_payment_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; s public.business_payment_settings%rowtype;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can change how transfers are taken.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_mode not in ('manual','cash_only','automatic') then raise exception 'Unknown mode.'; end if;
  select * into s from public.business_payment_settings where business_id = v_biz;
  if p_mode = 'automatic' and (not found or s.provider_status not in ('test','live')) then
    raise exception 'Connect your payment provider first, then switch automatic transfers on.';
  end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.business_payment_settings (business_id, mode, updated_at, updated_by_name)
  values (v_biz, p_mode, now(), v_name)
  on conflict (business_id) do update set mode = excluded.mode, updated_at = now(), updated_by_name = excluded.updated_by_name;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, details)
  values (v_biz, auth.uid(), v_role, 'payment_mode_changed', 'business_payment_settings', coalesce(v_name, 'Owner') || ' set transfers to: ' || p_mode);
  return jsonb_build_object('mode', p_mode);
end $function$;
revoke all on function public.set_payment_mode(text) from public, anon;
grant execute on function public.set_payment_mode(text) to authenticated, service_role;

-- 8. Cancel an order that is still waiting for the bank. A reason is required, and it is recorded. The stock goes back (the order becomes cancelled).
create or replace function public.cancel_unpaid_order(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; o public.orders%rowtype;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can cancel an order.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why the order is being cancelled.'; end if;
  select * into o from public.orders where id = p_order_id and business_id = v_biz for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.status <> 'awaiting_payment' then raise exception 'Only an order that is still waiting for the bank can be cancelled here.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  perform set_config('app.payment_internal', '1', true);
  update public.orders set status = 'cancelled' where id = o.id;
  update public.payment_requests set status = 'cancelled', cancel_reason = btrim(p_reason) where order_id = o.id and status in ('waiting','short');
  perform set_config('app.payment_internal', '', true);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'unpaid_order_cancelled', 'orders', o.id,
          format('%s cancelled an unpaid transfer order of %s kobo: %s', coalesce(v_name, 'Staff'), o.total_kobo, btrim(p_reason)));
  return jsonb_build_object('order_id', o.id, 'status', 'cancelled');
end $function$;
revoke all on function public.cancel_unpaid_order(uuid, text) from public, anon;
grant execute on function public.cancel_unpaid_order(uuid, text) to authenticated, service_role;

-- 9. Provider keys, kept in the database vault. Only the server (service key) can store or read them.
create or replace function public.save_payment_connection(p_business_id text, p_provider text, p_status text, p_contract_code text, p_api_key text, p_secret_key text, p_by_name text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare s public.business_payment_settings%rowtype; v_api uuid; v_key uuid;
begin
  if p_provider not in ('monnify','opay') or p_status not in ('test','live') then raise exception 'Bad provider or status.'; end if;
  select * into s from public.business_payment_settings where business_id = p_business_id;
  if found and s.api_key_secret_id is not null then
    perform vault.update_secret(s.api_key_secret_id, p_api_key);
    v_api := s.api_key_secret_id;
  else
    v_api := vault.create_secret(p_api_key, 'payment_api_' || p_business_id || '_' || p_provider, 'payment provider api key');
  end if;
  if found and s.secret_key_secret_id is not null then
    perform vault.update_secret(s.secret_key_secret_id, p_secret_key);
    v_key := s.secret_key_secret_id;
  else
    v_key := vault.create_secret(p_secret_key, 'payment_secret_' || p_business_id || '_' || p_provider, 'payment provider secret key');
  end if;
  insert into public.business_payment_settings (business_id, provider, provider_status, contract_code, api_key_secret_id, secret_key_secret_id, connected_at, updated_at, updated_by_name)
  values (p_business_id, p_provider, p_status, p_contract_code, v_api, v_key, now(), now(), p_by_name)
  on conflict (business_id) do update set provider = excluded.provider, provider_status = excluded.provider_status, contract_code = excluded.contract_code,
    api_key_secret_id = excluded.api_key_secret_id, secret_key_secret_id = excluded.secret_key_secret_id, connected_at = now(), updated_at = now(), updated_by_name = excluded.updated_by_name;
end $function$;
revoke all on function public.save_payment_connection(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_payment_connection(text, text, text, text, text, text, text) to service_role;

create or replace function public.read_payment_connection(p_business_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare s public.business_payment_settings%rowtype; v_api text; v_key text;
begin
  select * into s from public.business_payment_settings where business_id = p_business_id;
  if not found or s.api_key_secret_id is null then return null; end if;
  select decrypted_secret into v_api from vault.decrypted_secrets where id = s.api_key_secret_id;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = s.secret_key_secret_id;
  return jsonb_build_object('provider', s.provider, 'status', s.provider_status, 'contract_code', s.contract_code, 'api_key', v_api, 'secret_key', v_key, 'mode', s.mode);
end $function$;
revoke all on function public.read_payment_connection(text) from public, anon, authenticated;
grant execute on function public.read_payment_connection(text) to service_role;
