-- NairaPlate append-only records, step 1: catering payment history.
-- Run once in the Supabase SQL editor, BEFORE the new catering screen is released. Safe to re-run. Rollback: 20261019_catering_payments_rollback.sql
-- Every deposit and payment on a catering order becomes its own entry. Entries are never edited or deleted. A mistake is corrected by a
-- reversal entry (owner only, with a reason). The totals on the order are worked out from the entries, so everything that reads them is unchanged.
-- The old record_catering_payment keeps its name and result, so a screen that is still open from before keeps working.

-- 1. A reusable guard: a signed-in person can never change or delete a protected record. The server and the SQL editor can (admin work only).
create or replace function public.ledger_block_change()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then return coalesce(NEW, OLD); end if;
  raise exception 'This record cannot be changed or deleted. Add a correction instead.';
end $function$;

-- 2. The payment history.
create table if not exists public.catering_payments (
  id               uuid        primary key default gen_random_uuid(),
  business_id      text        not null references public.businesses(id) on delete cascade,
  order_id         uuid        not null references public.catering_deposits(id) on delete cascade,
  kind             text        not null check (kind in ('deposit','payment','reversal')),
  amount_kobo      bigint      not null,
  method           text        check (method is null or method in ('cash','transfer')),
  reverses_id      uuid        references public.catering_payments(id),
  reason           text,
  carried_over     boolean     not null default false,
  recorded_by      uuid,
  recorded_by_name text,
  created_at       timestamptz not null default now(),
  constraint catering_payments_amount_rule check ((kind in ('deposit','payment') and amount_kobo > 0) or (kind = 'reversal' and amount_kobo < 0)),
  constraint catering_payments_reversal_rule check ((kind = 'reversal') = (reverses_id is not null)),
  constraint catering_payments_reason_rule check (kind <> 'reversal' or length(btrim(coalesce(reason, ''))) >= 5)
);
create unique index if not exists catering_payments_one_reversal on public.catering_payments (reverses_id) where reverses_id is not null;
create index if not exists catering_payments_order_idx on public.catering_payments (order_id, created_at);

alter table public.catering_payments enable row level security;
drop policy if exists catering_payments_select on public.catering_payments;
create policy catering_payments_select on public.catering_payments for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.catering_payments from anon, authenticated;
grant select on public.catering_payments to authenticated;
grant all on public.catering_payments to service_role;

drop trigger if exists catering_payments_no_change on public.catering_payments;
create trigger catering_payments_no_change before update or delete on public.catering_payments
  for each row execute function public.ledger_block_change();

-- 3. A reversal must undo exactly one real payment of the same order, once. Enforced here whoever writes it.
create or replace function public.catering_payments_check_reversal()
returns trigger language plpgsql set search_path to 'public' as $function$
declare o public.catering_payments%rowtype;
begin
  if NEW.kind <> 'reversal' then return NEW; end if;
  select * into o from public.catering_payments where id = NEW.reverses_id;
  if not found then raise exception 'The payment being reversed was not found.'; end if;
  if o.kind not in ('deposit','payment') then raise exception 'Only a deposit or a payment can be reversed.'; end if;
  if o.order_id <> NEW.order_id or o.business_id <> NEW.business_id then raise exception 'That payment belongs to a different order.'; end if;
  if NEW.amount_kobo <> -o.amount_kobo then raise exception 'A reversal must be for exactly the amount of the payment.'; end if;
  return NEW;
end $function$;
drop trigger if exists catering_payments_check_reversal on public.catering_payments;
create trigger catering_payments_check_reversal before insert on public.catering_payments
  for each row execute function public.catering_payments_check_reversal();

-- 4. The totals on the order come from the entries.
create or replace function public.catering_payments_recompute()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_dep bigint; v_add bigint;
begin
  if current_setting('app.ledger_backfill', true) = '1' then return NEW; end if;
  perform 1 from public.catering_deposits where id = NEW.order_id for update;   -- one change at a time per order
  select coalesce(sum(p.amount_kobo) filter (where p.kind = 'deposit' or (p.kind = 'reversal' and o.kind = 'deposit')), 0),
         coalesce(sum(p.amount_kobo) filter (where p.kind = 'payment' or (p.kind = 'reversal' and o.kind = 'payment')), 0)
    into v_dep, v_add
    from public.catering_payments p left join public.catering_payments o on o.id = p.reverses_id
   where p.order_id = NEW.order_id;
  update public.catering_deposits
     set deposit_kobo = v_dep, additional_payments_kobo = v_add, settled = (v_dep + v_add) >= total_contract_kobo
   where id = NEW.order_id;
  return NEW;
end $function$;
drop trigger if exists catering_payments_recompute on public.catering_payments;
create trigger catering_payments_recompute after insert on public.catering_payments
  for each row execute function public.catering_payments_recompute();

-- 5. Carry over what exists today: one deposit entry and one "carried over" payment entry per order, matching the old totals exactly.
--    Nothing is recalculated for these rows (the totals and the settled flag stay as they are).
do $$ declare o record; begin
  perform set_config('app.ledger_backfill', '1', true);
  for o in select * from public.catering_deposits c where not exists (select 1 from public.catering_payments p where p.order_id = c.id) loop
    if o.deposit_kobo > 0 then
      insert into public.catering_payments (business_id, order_id, kind, amount_kobo, carried_over, recorded_by_name, created_at)
      values (o.business_id, o.id, 'deposit', o.deposit_kobo, true, 'Carried over', o.created_at);
    end if;
    if coalesce(o.additional_payments_kobo, 0) > 0 then
      insert into public.catering_payments (business_id, order_id, kind, amount_kobo, carried_over, recorded_by_name, created_at)
      values (o.business_id, o.id, 'payment', o.additional_payments_kobo, true, 'Carried over (history before this record began)', o.created_at);
    end if;
  end loop;
  perform set_config('app.ledger_backfill', '', true);
end $$;

-- 6. Making an order: the deposit is the first entry.
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

  -- The deposit is the first entry in the order's payment history. The totals on the order are worked out from the entries by a trigger.
  insert into public.catering_deposits (business_id, customer_name, phone, event_date, event_time, total_contract_kobo, deposit_kobo, items_summary, settled,
                                        status, delivery_address, notes, delivery_fee_kobo, discount_kobo, subtotal_kobo)
  values (v_biz, btrim(p_customer), nullif(btrim(coalesce(p_phone, '')), ''), p_event_date, p_event_time, v_total, 0, v_summary, false,
          p_status, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), v_fee, v_disc, v_sub)
  returning id into v_id;

  insert into public.catering_order_items (business_id, order_id, recipe_id, recipe_name, quantity, unit_price_kobo, line_total_kobo, is_custom)
  select v_biz, v_id, nullif(l->>'recipe_id', '')::uuid, l->>'name', (l->>'qty')::numeric, (l->>'price')::bigint, round((l->>'price')::bigint * (l->>'qty')::numeric), (l->>'custom')::boolean
    from jsonb_array_elements(v_lines) l;

  select display_name into v_name from public.staff_users where id = auth.uid();
  if v_dep > 0 then
    insert into public.catering_payments (business_id, order_id, kind, amount_kobo, recorded_by, recorded_by_name)
    values (v_biz, v_id, 'deposit', v_dep, auth.uid(), coalesce(v_name, 'Staff'));
  end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_order_created', 'catering_deposits', v_id,
          format('%s took a catering order for %s on %s: %s kobo, deposit %s kobo', coalesce(v_name, 'Staff'), btrim(p_customer), p_event_date, v_total, v_dep));
  return jsonb_build_object('id', v_id, 'subtotal_kobo', v_sub, 'total_kobo', v_total, 'deposit_kobo', v_dep, 'balance_kobo', v_total - v_dep, 'summary', v_summary);
end $function$;
revoke all on function public.create_catering_order(text, text, date, time, text, text, jsonb, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.create_catering_order(text, text, date, time, text, text, jsonb, bigint, bigint, bigint, text) to authenticated, service_role;

-- 7. Recording a payment. The old two-argument name stays and gives the same answer as before.
create or replace function public.record_catering_payment_v2(p_booking_id uuid, p_amount_kobo bigint, p_method text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; o public.catering_deposits%rowtype;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can record payments.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if p_method is not null and p_method not in ('cash','transfer') then raise exception 'Payment method must be cash or transfer.'; end if;
  select * into o from public.catering_deposits where id = p_booking_id and business_id = v_biz for update;
  if not found then raise exception 'Booking not found.'; end if;
  if o.status = 'cancelled' then raise exception 'A cancelled order cannot take a payment.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.catering_payments (business_id, order_id, kind, amount_kobo, method, recorded_by, recorded_by_name)
  values (v_biz, o.id, 'payment', p_amount_kobo, p_method, auth.uid(), coalesce(v_name, 'Staff'));
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_payment_recorded', 'catering_deposits', o.id,
          format('%s recorded a payment of %s kobo for %s', coalesce(v_name, 'Staff'), p_amount_kobo, o.customer_name));
  select * into o from public.catering_deposits where id = o.id;
  return jsonb_build_object('received_kobo', o.deposit_kobo + o.additional_payments_kobo,
                            'remaining_kobo', o.total_contract_kobo - o.deposit_kobo - o.additional_payments_kobo, 'settled', o.settled);
end $function$;
revoke all on function public.record_catering_payment_v2(uuid, bigint, text) from public, anon;
grant execute on function public.record_catering_payment_v2(uuid, bigint, text) to authenticated, service_role;

create or replace function public.record_catering_payment(p_booking_id uuid, p_amount_kobo bigint)
returns jsonb language sql security definer set search_path to 'public' as $function$
  select public.record_catering_payment_v2(p_booking_id, p_amount_kobo, null)
$function$;
revoke all on function public.record_catering_payment(uuid, bigint) from public, anon;
grant execute on function public.record_catering_payment(uuid, bigint) to authenticated, service_role;

-- 8. Reversing a payment: owner only, with a reason of 5 or more characters. The original stays; a minus entry is added beside it.
create or replace function public.reverse_catering_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; p public.catering_payments%rowtype; o public.catering_deposits%rowtype; v_id uuid;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a payment.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into p from public.catering_payments where id = p_payment_id and business_id = v_biz;
  if not found then raise exception 'Payment not found.'; end if;
  if p.kind not in ('deposit','payment') then raise exception 'Only a deposit or a payment can be reversed.'; end if;
  select * into o from public.catering_deposits where id = p.order_id for update;
  if exists (select 1 from public.catering_payments where reverses_id = p.id) then raise exception 'This payment has already been reversed.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.catering_payments (business_id, order_id, kind, amount_kobo, method, reverses_id, reason, recorded_by, recorded_by_name)
  values (v_biz, p.order_id, 'reversal', -p.amount_kobo, p.method, p.id, btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner'))
  returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'catering_payment_reversed', 'catering_deposits', p.order_id,
          format('%s reversed a payment of %s kobo for %s: %s', coalesce(v_name, 'Owner'), p.amount_kobo, o.customer_name, btrim(p_reason)));
  select * into o from public.catering_deposits where id = p.order_id;
  return jsonb_build_object('reversal_id', v_id, 'received_kobo', o.deposit_kobo + o.additional_payments_kobo,
                            'remaining_kobo', o.total_contract_kobo - o.deposit_kobo - o.additional_payments_kobo, 'settled', o.settled);
end $function$;
revoke all on function public.reverse_catering_payment(uuid, text) from public, anon;
grant execute on function public.reverse_catering_payment(uuid, text) to authenticated, service_role;
