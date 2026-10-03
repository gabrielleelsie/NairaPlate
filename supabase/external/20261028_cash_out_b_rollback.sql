-- Rollback for Step 8 part B: removes the deposit-method rule and puts the old catering order function (no deposit method) back as it was.
alter table public.catering_payments drop constraint if exists catering_payments_deposit_method_rule;
create or replace function public.create_catering_order(
  p_customer text, p_phone text, p_event_date date, p_event_time time without time zone, p_address text, p_notes text, p_items jsonb,
  p_delivery_fee_kobo bigint, p_discount_kobo bigint, p_deposit_kobo bigint, p_status text default 'confirmed')
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
revoke all on function public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.create_catering_order(text, text, date, time without time zone, text, text, jsonb, bigint, bigint, bigint, text) to authenticated;
