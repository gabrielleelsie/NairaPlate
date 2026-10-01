-- NairaPlate automatic transfer confirmation, part B: create a transfer order, and apply the bank's payment message.
-- Run AFTER part A. Safe to re-run. Rollback: 20261012_payments_b_rollback.sql

-- 1. The Till creates a transfer order. Prices come from the database. The order waits for the bank; stock comes off now (the food is being made)
-- and goes back if the order is cancelled.
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
    select selling_price_kobo into v_price from public.recipes where id = (it->>'recipe_id')::uuid and business_id = v_biz;
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
    from jsonb_array_elements(p_items) x join public.recipes r on r.id = (x->>'recipe_id')::uuid;
  perform set_config('app.payment_internal', '', true);

  v_ref := 'NP' || upper(replace(v_order::text, '-', ''));
  insert into public.payment_requests (business_id, order_id, provider, reference, amount_kobo, expires_at, created_by)
  values (v_biz, v_order, s.provider, v_ref, v_total, v_exp, auth.uid())
  returning id into v_req;
  return jsonb_build_object('order_id', v_order, 'request_id', v_req, 'reference', v_ref, 'amount_kobo', v_total, 'expires_at', v_exp, 'provider', s.provider, 'status', s.provider_status);
end $function$;
revoke all on function public.create_transfer_order(text, text, jsonb) from public, anon;
grant execute on function public.create_transfer_order(text, text, jsonb) to authenticated, service_role;

-- 2. The server stores the one-time account the provider gave for a request.
create or replace function public.attach_payment_account(p_request_id uuid, p_account_number text, p_bank_name text, p_account_name text, p_expires_at timestamptz)
returns void language sql security definer set search_path to 'public' as $function$
  update public.payment_requests
     set account_number = p_account_number, bank_name = p_bank_name, account_name = p_account_name, expires_at = coalesce(p_expires_at, expires_at)
   where id = p_request_id and status in ('waiting','short');
$function$;
revoke all on function public.attach_payment_account(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_payment_account(uuid, text, text, text, timestamptz) to service_role;

-- 3. The bank's message. Called only by the server, after it has checked the provider's signature.
create or replace function public.record_provider_payment(p_provider text, p_event_id text, p_reference text, p_amount_kobo bigint, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  r public.payment_requests%rowtype; v_inserted int; v_total bigint; v_outcome text;
  naira text := to_char(p_amount_kobo / 100.0, 'FM999,999,990.00');
begin
  insert into public.payment_events (provider, event_id, reference, amount_kobo, raw)
  values (p_provider, p_event_id, p_reference, p_amount_kobo, p_raw)
  on conflict (provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return jsonb_build_object('outcome', 'duplicate'); end if;

  select * into r from public.payment_requests where reference = p_reference for update;
  if not found then
    update public.payment_events set outcome = 'unmatched' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'unmatched');
  end if;
  update public.payment_events set business_id = r.business_id where provider = p_provider and event_id = p_event_id;

  if r.status = 'paid' then
    v_outcome := 'already_paid';
    insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
    values (r.business_id, 'unmatched_payment', 'warn', format('An extra payment of ₦%s arrived for an order that was already paid (reference %s). Check the bank record.', naira, p_reference), 'owner', false);
  elsif r.status = 'cancelled' then
    v_outcome := 'after_cancel';
    insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
    values (r.business_id, 'unmatched_payment', 'critical', format('₦%s was paid for an order that had been cancelled (reference %s). The customer may be owed their goods or a refund.', naira, p_reference), 'owner', false);
  else
    v_total := coalesce(r.paid_amount_kobo, 0) + p_amount_kobo;
    if v_total < r.amount_kobo then
      v_outcome := 'short';
      update public.payment_requests set status = 'short', paid_amount_kobo = v_total, provider_ref = p_event_id where id = r.id;
      insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
      values (r.business_id, 'short_payment', 'warn', format('A transfer of ₦%s arrived, ₦%s short of the order (reference %s). The order is still waiting.', naira, to_char((r.amount_kobo - v_total) / 100.0, 'FM999,999,990.00'), p_reference), 'owner', false);
    else
      v_outcome := 'paid';
      perform set_config('app.payment_internal', '1', true);
      update public.orders set status = 'paid' where id = r.order_id and status = 'awaiting_payment';
      perform set_config('app.payment_internal', '', true);
      update public.payment_requests set status = 'paid', paid_amount_kobo = v_total, paid_at = now(), provider_ref = p_event_id where id = r.id;
      if v_total > r.amount_kobo then
        insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
        values (r.business_id, 'overpayment', 'info', format('A customer paid ₦%s too much on an order (reference %s).', to_char((v_total - r.amount_kobo) / 100.0, 'FM999,999,990.00'), p_reference), 'owner', false);
      end if;
      insert into public.audit_logs (business_id, actor_role, action, entity_type, entity_id, details)
      values (r.business_id, 'system', 'transfer_received', 'orders', r.order_id, format('Transfer of ₦%s confirmed by the bank (reference %s)', naira, p_reference));
    end if;
  end if;
  update public.payment_events set outcome = v_outcome where provider = p_provider and event_id = p_event_id;
  return jsonb_build_object('outcome', v_outcome, 'business_id', r.business_id, 'order_id', r.order_id);
end $function$;
revoke all on function public.record_provider_payment(text, text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_payment(text, text, text, bigint, jsonb) to service_role;
