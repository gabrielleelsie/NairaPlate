-- NairaPlate: SNAPSHOT of five live functions as they stood on 6 October 2026. REFERENCE ONLY.
-- Why this file exists (Master Specification, Part 9, S5): the repository's migration files describe how these functions were first written,
-- but the live database had since changed (some by direct edits made outside the repository, some by the fix scripts, which patch the live text).
-- The text below was read from the live database and each function was checked by loading it into a local database and comparing a hash of its body
-- with the same hash taken on the live database. All five matched exactly. Re-running this file on the live database would replace each function with
-- its own current text, so it changes nothing; it is meant for reading, rebuilding a copy of the database, and spotting future drift.
-- Grants are NOT part of this file (CREATE OR REPLACE keeps them): see the access notes under each function.
--
-- Functions that differ from their repository file only in SQL comments (no logic): apply_due_dish_prices, ingredient_price_at, set_recipe_dish_id.
-- In this snapshot: submit_late_entry, dish_price_at, approve_and_post_late_entry, cancel_unpaid_order, resolve_late_entry_recipe.
-- Order the live text was built in: 20261101 (created) -> edited directly on the live database -> 20261106 -> 20261109 (submit_late_entry);
-- 20261105 -> 20261106 -> 20261107 (approve_and_post_late_entry); 20261012 -> 20261107 -> 20261110 (cancel_unpaid_order).

-- ===== 1. submit_late_entry. Access: signed-in people (authenticated), not visitors. =====
CREATE OR REPLACE FUNCTION public.submit_late_entry(p_client_sale_id uuid, p_paper_reference text, p_actual_sold_at timestamp with time zone, p_outage_reason text, p_payment_method text, p_cash_kobo bigint, p_transfer_kobo bigint, p_items jsonb, p_notes text DEFAULT NULL::text, p_channel text DEFAULT 'walk_in'::text, p_price_tier text DEFAULT 'standard'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_biz         text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role        text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid         uuid := auth.uid();
  v_entry_id    uuid;
  v_delay_sec   integer;
  v_total       bigint := 0;
  v_init_stat   text := 'submitted';
  v_shift_id    uuid;
  v_shift_stat  text;
  it            jsonb;
  v_qty         numeric;
  v_dish_uuid   uuid;
  v_dish_id     uuid;
  v_dish_name   text;
  v_price_id    uuid;
  v_unit_price  bigint;
  v_item_tot    bigint;
BEGIN
  IF v_biz IS NULL OR v_role NOT IN ('cashier', 'owner', 'supa_admin') THEN
    RAISE EXCEPTION 'Only cashiers and owners can submit late paper sales.';
  END IF;

  IF NOT (SELECT public.business_has_access(v_biz)) THEN
    RAISE EXCEPTION 'Your plan has ended.';
  END IF;

  IF p_client_sale_id IS NULL THEN
    RAISE EXCEPTION 'A unique client sale identifier is required.';
  END IF;

  -- 1. Idempotency check (do not touch v_total)
  SELECT id, status INTO v_entry_id, v_init_stat
    FROM public.late_entries
   WHERE client_sale_id = p_client_sale_id AND business_id = v_biz
   LIMIT 1;

  IF v_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'late_entry_id', v_entry_id,
      'status', v_init_stat,
      'already_submitted', true
    );
  END IF;

  v_total := 0;
  v_init_stat := 'submitted';

  -- 2. Basic validations
  IF p_actual_sold_at IS NULL THEN
    RAISE EXCEPTION 'Actual sale time is required.';
  END IF;

  v_delay_sec := greatest(0, round(extract(epoch from (now() - p_actual_sold_at))))::integer;
  IF v_delay_sec < 60 THEN
    RAISE EXCEPTION 'A late entry must have occurred at least 1 minute in the past.';
  END IF;
  IF v_delay_sec > 259200 THEN
    RAISE EXCEPTION 'Late entries cannot be recorded more than 72 hours after the sale.';
  END IF;

  IF p_paper_reference IS NULL OR length(btrim(p_paper_reference)) < 2 THEN
    RAISE EXCEPTION 'Paper ticket reference is required (at least 2 characters).';
  END IF;
  IF p_outage_reason IS NULL OR length(btrim(p_outage_reason)) < 3 THEN
    RAISE EXCEPTION 'Outage reason is required (at least 3 characters).';
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'split') THEN
    RAISE EXCEPTION 'Late entries only support cash, transfer, or split payments.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required.';
  END IF;

  -- 3. Shift context lookup
  SELECT id, status INTO v_shift_id, v_shift_stat
    FROM public.cash_drawers
   WHERE business_id = v_biz
     AND opened_at <= p_actual_sold_at
     AND (closed_at IS NULL OR closed_at >= p_actual_sold_at)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF v_shift_id IS NULL OR v_shift_stat = 'closed' THEN
    v_init_stat := 'needs_shift_review';
  END IF;

  -- 4. Calculate items total using dish price lookup with guaranteed fallback
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (it->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every item needs a quantity greater than zero.';
    END IF;

    v_dish_uuid := (it->>'recipe_id')::uuid;

    SELECT coalesce(dish_id, id), name INTO v_dish_id, v_dish_name
      FROM public.recipes
     WHERE id = v_dish_uuid AND business_id = v_biz;

    IF v_dish_name IS NULL THEN
      RAISE EXCEPTION 'A dish in this entry was not found on your menu.';
    END IF;

    v_price_id := NULL;
    v_unit_price := NULL;

    SELECT id, price_kobo INTO v_price_id, v_unit_price
      FROM public.dish_price_strict(v_dish_id, p_actual_sold_at)
     LIMIT 1;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'No menu price was on record for "%" at the time of this sale. %. A later price, or today''s price, is never used for an earlier sale.', v_dish_name,
        coalesce((SELECT 'Its first recorded price starts on ' || to_char(min(dp.effective_from) AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' (Nigeria time)'
                    FROM public.dish_prices dp WHERE dp.dish_id = v_dish_id AND dp.cancelled_at IS NULL),
                 'No price has been recorded for this dish yet');
    END IF;
    v_item_tot := round(v_unit_price * v_qty);
    v_total := v_total + v_item_tot;
  END LOOP;

  -- 5. Payment amount validation
  IF coalesce(p_cash_kobo, 0) < 0 OR coalesce(p_transfer_kobo, 0) < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;
  IF coalesce(p_cash_kobo, 0) + coalesce(p_transfer_kobo, 0) <> v_total THEN
    RAISE EXCEPTION 'Cash and transfer must add up exactly to the total (% kobo).', v_total;
  END IF;
  IF p_payment_method = 'cash' AND coalesce(p_transfer_kobo, 0) <> 0 THEN
    RAISE EXCEPTION 'A cash sale cannot have a transfer amount.';
  END IF;
  IF p_payment_method = 'transfer' AND coalesce(p_cash_kobo, 0) <> 0 THEN
    RAISE EXCEPTION 'A transfer sale cannot have a cash amount.';
  END IF;
  IF p_payment_method = 'split' AND (coalesce(p_cash_kobo, 0) <= 0 OR coalesce(p_transfer_kobo, 0) <= 0) THEN
    RAISE EXCEPTION 'A split sale requires both a cash and a transfer amount.';
  END IF;

  -- 6. Insert header
  PERFORM set_config('app.late_internal', '1', true);
  INSERT INTO public.late_entries (
    business_id, client_sale_id, paper_reference, status,
    actual_sold_at, delay_seconds, outage_reason, entered_by,
    source_shift_id, channel, price_tier, payment_method,
    cash_kobo, transfer_kobo, total_kobo, notes
  ) VALUES (
    v_biz, p_client_sale_id, btrim(p_paper_reference), v_init_stat,
    p_actual_sold_at, v_delay_sec, btrim(p_outage_reason), v_uid,
    v_shift_id, coalesce(p_channel, 'walk_in'), coalesce(p_price_tier, 'standard'), p_payment_method,
    coalesce(p_cash_kobo, 0), coalesce(p_transfer_kobo, 0), v_total, p_notes
  ) RETURNING id INTO v_entry_id;

  -- 7. Insert items
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (it->>'quantity')::numeric;
    v_dish_uuid := (it->>'recipe_id')::uuid;

    SELECT coalesce(dish_id, id), name INTO v_dish_id, v_dish_name
      FROM public.recipes
     WHERE id = v_dish_uuid AND business_id = v_biz;

    v_price_id := NULL;
    v_unit_price := NULL;

    SELECT id, price_kobo INTO v_price_id, v_unit_price
      FROM public.dish_price_strict(v_dish_id, p_actual_sold_at)
     LIMIT 1;

    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'No menu price was on record for "%" at the time of this sale. %. A later price, or today''s price, is never used for an earlier sale.', v_dish_name,
        coalesce((SELECT 'Its first recorded price starts on ' || to_char(min(dp.effective_from) AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY HH24:MI') || ' (Nigeria time)'
                    FROM public.dish_prices dp WHERE dp.dish_id = v_dish_id AND dp.cancelled_at IS NULL),
                 'No price has been recorded for this dish yet');
    END IF;
    v_item_tot := round(v_unit_price * v_qty);

    INSERT INTO public.late_entry_items (
      late_entry_id, business_id, recipe_id, dish_name,
      quantity, dish_price_id, unit_price_kobo, line_total_kobo
    ) VALUES (
      v_entry_id, v_biz, v_dish_uuid, v_dish_name,
      v_qty, v_price_id, v_unit_price, v_item_tot
    );
  END LOOP;
  PERFORM set_config('app.late_internal', '', true);

  -- 8. Audit log
  INSERT INTO public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_biz, v_uid, v_role, 'late_entry_submitted', 'late_entries', v_entry_id,
    format('Late entry submitted with paper ref "%s", amount ₦%s, delay %s min',
      p_paper_reference, to_char(v_total / 100.0, 'FM999,999,990.00'), round(v_delay_sec / 60.0))
  );

  RETURN jsonb_build_object(
    'late_entry_id', v_entry_id,
    'status', v_init_stat,
    'total_kobo', v_total,
    'already_submitted', false
  );
END;
$function$;

-- ===== 2. dish_price_at. Edited directly on the live database: accepts the dish identifier or any saved version's identifier. Falls back to the dish's EARLIEST price when none had started (the Till relies on this; paper entries no longer use it, see dish_price_strict in 20261109). Access: authenticated, service_role. =====
CREATE OR REPLACE FUNCTION public.dish_price_at(p_dish uuid, p_at timestamp with time zone)
 RETURNS TABLE(id uuid, price_kobo bigint, effective_from timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dish uuid;
BEGIN
  SELECT coalesce(r.dish_id, r.id) INTO v_dish
    FROM public.recipes r
   WHERE r.id = p_dish OR r.dish_id = p_dish
   LIMIT 1;

  IF v_dish IS NULL THEN
    v_dish := p_dish;
  END IF;

  RETURN QUERY
  SELECT dp.id, dp.price_kobo, dp.effective_from
    FROM public.dish_prices dp
   WHERE dp.dish_id = v_dish
     AND dp.cancelled_at IS NULL
     AND dp.effective_from <= p_at
   ORDER BY dp.effective_from DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT dp.id, dp.price_kobo, dp.effective_from
      FROM public.dish_prices dp
     WHERE dp.dish_id = v_dish
       AND dp.cancelled_at IS NULL
     ORDER BY dp.effective_from ASC
     LIMIT 1;
  END IF;
END;
$function$;

-- ===== 3. approve_and_post_late_entry (rebuilt by replaying 20261105, 20261106, 20261107 on a local copy; hash matches live). Access: authenticated. =====
CREATE OR REPLACE FUNCTION public.approve_and_post_late_entry(p_id uuid, p_shift_resolution text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_cost_decision text DEFAULT NULL::text, p_estimate_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_biz         text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role        text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid         uuid := auth.uid();
  e             public.late_entries%rowtype;
  v_order_id    uuid;
  v_cur_open_shift uuid;
  it            record;
  v_order_stat  text := 'paid';
  v_resolution  text;
  v_ver         uuid;
  v_res         jsonb;
  v_all         boolean := true;
  v_unres       jsonb := '[]'::jsonb;
  v_missing     text;
  v_decision    text;
  v_src         public.cash_drawers%rowtype;
begin
  if v_biz is null or v_role not in ('owner', 'supa_admin') then
    raise exception 'Only business owners can approve and post late entries.';
  end if;
  if not (select public.business_has_access(v_biz)) then
    raise exception 'Your plan has ended.';
  end if;

  select * into e from public.late_entries where id = p_id and business_id = v_biz for update;
  if not found then
    raise exception 'Late entry record not found.';
  end if;
  if e.status = 'posted' then
    return jsonb_build_object('order_id', e.posted_order_id, 'already_posted', true);
  end if;
  if e.status not in ('submitted', 'needs_shift_review') then
    raise exception 'This late entry is % and cannot be approved.', e.status;
  end if;
  if p_cost_decision is not null and p_cost_decision <> 'estimate_current_price' then
    raise exception 'Cost decision must be empty or estimate_current_price.';
  end if;

  -- Food cost at the actual sale time, worked out here (never taken from the app).
  for it in select * from public.late_entry_items where late_entry_id = p_id order by created_at, id loop
    select cur.id into v_ver
      from recipes picked
      join recipes cur on cur.business_id = picked.business_id and cur.name = picked.name and cur.is_current
     where picked.id = it.recipe_id;
    v_ver := coalesce(v_ver, it.recipe_id);
    v_res := public.recipe_plate_cost_at(v_ver, v_biz, e.actual_sold_at);
    if not (v_res ->> 'is_complete')::boolean then
      v_all := false;
      v_unres := v_unres || jsonb_build_array(jsonb_build_object('dish_name', it.dish_name, 'recipe_version_id', v_ver,
                   'unresolved_ingredients', v_res -> 'unresolved_ingredients'));
    end if;
  end loop;

  if v_all then
    v_decision := 'historical';
  else
    select string_agg(distinct coalesce(u ->> 'ingredient_name', 'recipe'), ', ') into v_missing
      from jsonb_array_elements(v_unres) d, jsonb_array_elements(d -> 'unresolved_ingredients') u;
    if p_cost_decision is distinct from 'estimate_current_price' then
      raise exception 'Food cost unknown at the sale time (no price then for: %). Hold this entry, or approve it using today''s cost as an estimate with a reason.', v_missing;
    end if;
    if length(btrim(coalesce(p_estimate_reason, ''))) < 5 then
      raise exception 'Give a reason of at least 5 letters for using today''s cost as an estimate.';
    end if;
    v_decision := 'estimate_current_price';
  end if;

  perform set_config('app.late_internal', '1', true);
  update public.late_entries
     set cost_decision = v_decision,
         cost_decided_at = now(),
         cost_decided_by = v_uid,
         cost_estimate_reason = case when v_decision = 'estimate_current_price' then btrim(p_estimate_reason) end,
         cost_unresolved_ingredients = case when v_decision = 'estimate_current_price' then v_unres end
   where id = p_id;
  perform set_config('app.late_internal', '', true);

  -- Shift context: the shift the sale really happened in (fixed when the entry was sent), and whether it is still open.
  select * into v_src from public.cash_drawers where id = e.source_shift_id and business_id = v_biz;

  if e.source_shift_id is null then
    if p_shift_resolution is distinct from 'outside_shift_cash' then
      raise exception 'This sale is outside any shift. Reject it, or approve it as outside_shift_cash with a reason.';
    end if;
    if length(btrim(coalesce(p_notes, ''))) < 5 then
      raise exception 'Type a reason of at least 5 characters for cash outside any shift.';
    end if;
    v_resolution := 'outside_shift_cash';
  elsif v_src.status is distinct from 'open' then
    if p_shift_resolution is null or p_shift_resolution not in ('closed_shift_included', 'closed_shift_late_cash') then
      raise exception 'Closed-shift entries require an explicit resolution: closed_shift_included or closed_shift_late_cash.';
    end if;
    if length(btrim(coalesce(p_notes, ''))) < 5 then
      raise exception 'Type a reason of at least 5 characters for this closed-shift choice.';
    end if;
    v_resolution := p_shift_resolution;

    if v_resolution = 'closed_shift_late_cash' and e.cash_kobo > 0 and e.source_shift_id is not null then
      declare
        v_d public.cash_drawers%rowtype; v_nm text;
      begin
        select * into v_d from public.cash_drawers where id = e.source_shift_id and business_id = v_biz for update;
        if not found or v_d.status <> 'closed' then raise exception 'The shift this sale belongs to is not a closed shift, so late cash cannot be added to it. Choose closed_shift_included instead.'; end if;
        if v_d.closing_counted_kobo is null then raise exception 'That shift was closed without a count, so there is no count to add late cash to. Choose closed_shift_included instead.'; end if;
        select display_name into v_nm from public.staff_users where id = v_uid;
        insert into public.cash_drawer_adjustments (business_id, drawer_id, amount_kobo, reason, recorded_by, recorded_by_name)
        values (v_biz, e.source_shift_id, e.cash_kobo, format('Late cash from paper ref %s', e.paper_reference), v_uid, coalesce(v_nm, 'Owner'));
        insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
        values (v_biz, v_uid, v_role, 'drawer_count_adjusted', 'cash_drawers', e.source_shift_id,
                format('%s added late cash of %s kobo to a closed shift (paper ref %s)', coalesce(v_nm, 'Owner'), e.cash_kobo, e.paper_reference));
      end;
    end if;
  else
    v_resolution := 'open_shift_direct';
  end if;

  -- Payment status: pure transfer starts as awaiting_payment
  if e.payment_method in ('transfer', 'split') then
    v_order_stat := 'awaiting_payment';
  else
    v_order_stat := 'paid';
  end if;

  -- 1. Create authoritative order
  perform set_config('app.payment_internal', '1', true);
  insert into public.orders (
    business_id, channel, price_tier, subtotal_kobo, total_kobo,
    status, payment_method, cash_amount_kobo, transfer_amount_kobo,
    created_by, client_sale_id, is_late_entry, actual_sold_at,
    paper_reference, late_delay_seconds, late_entered_by, late_approved_by
  ) values (
    v_biz, e.channel, e.price_tier, e.total_kobo, e.total_kobo,
    v_order_stat, e.payment_method, e.cash_kobo, e.transfer_kobo,
    e.entered_by, e.client_sale_id, true, e.actual_sold_at,
    e.paper_reference, e.delay_seconds, e.entered_by, v_uid
  ) returning id into v_order_id;
  perform set_config('app.payment_internal', '', true);

  -- 2. Order lines: the line trigger costs each one at the sale time (flag names this order only)
  perform set_config('app.late_cost', v_order_id::text, true);
  for it in select * from public.late_entry_items where late_entry_id = p_id order by created_at, id loop
    insert into public.order_items (
      business_id, order_id, recipe_id, quantity, unit_price_kobo
    ) values (
      v_biz, v_order_id, it.recipe_id, it.quantity, it.unit_price_kobo
    );
  end loop;
  perform set_config('app.late_cost', '', true);

  -- 3. Mark late entry posted
  perform set_config('app.late_internal', '1', true);
  update public.late_entries
     set status = 'posted',
         posted_order_id = v_order_id,
         approved_by = v_uid,
         approved_at = now(),
         shift_resolution = v_resolution,
         notes = coalesce(p_notes, notes)
   where id = p_id;
  perform set_config('app.late_internal', '', true);

  -- 4. Audit log
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (
    v_biz, v_uid, v_role, 'late_entry_posted', 'orders', v_order_id,
    format('Late entry "%s" approved & posted as Order #%s (%s; food cost: %s)', e.paper_reference, v_order_id, v_resolution,
      case when v_decision = 'historical' then 'at sale time' else 'estimated at today''s prices' end)
  );
  if v_decision = 'estimate_current_price' then
    insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
    values (
      v_biz, v_uid, v_role, 'late_entry_cost_estimated', 'late_entries', p_id,
      format('Paper ref "%s": no ingredient price at the sale time for %s. Owner approved today''s cost as an estimate. Reason: %s',
        e.paper_reference, v_missing, btrim(p_estimate_reason))
    );
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'late_entry_id', p_id,
    'status', 'posted',
    'cost_decision', v_decision,
    'already_posted', false
  );
end $function$

;

-- ===== 4. cancel_unpaid_order (rebuilt by replaying 20261012, 20261107, 20261110 on a local copy; hash matches live). Access: authenticated. =====
CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if coalesce(o.is_late_entry, false) and coalesce(o.cash_amount_kobo, 0) > 0 then raise exception 'Cash was already taken for this paper sale, so it cannot be cancelled here. Confirm the transfer, or mark the transfer as lost if it never arrives.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  perform set_config('app.payment_internal', '1', true);
  update public.orders set status = 'cancelled' where id = o.id;
  update public.payment_requests set status = 'cancelled', cancel_reason = btrim(p_reason) where order_id = o.id and status in ('waiting','short');
  perform set_config('app.payment_internal', '', true);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'unpaid_order_cancelled', 'orders', o.id,
          format('%s cancelled an unpaid transfer order of %s kobo: %s', coalesce(v_name, 'Staff'), o.total_kobo, btrim(p_reason)));
  return jsonb_build_object('order_id', o.id, 'status', 'cancelled');
end $function$

;

-- ===== 5. resolve_late_entry_recipe. EXISTS ONLY ON THE LIVE DATABASE (no migration file ever created it). Nothing uses it: no function, trigger, policy, view or app code. =====
-- Security note: it is SECURITY DEFINER, takes the business id as a parameter instead of reading the caller's own, and signed-in people could run it, so a person of one business could look up another business's dish identifiers. Closed by 20261111_resolve_late_entry_recipe_hygiene.sql.
CREATE OR REPLACE FUNCTION public.resolve_late_entry_recipe(p_biz text, p_identifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recipe_id uuid;
  v_uuid_candidate uuid;
begin
  if p_biz is null or p_identifier is null or length(btrim(p_identifier)) = 0 then
    return null;
  end if;

  -- Step A: If input is a valid UUID, verify existence in public.recipes
  begin
    v_uuid_candidate := p_identifier::uuid;
    select id into v_recipe_id
      from public.recipes
     where business_id = p_biz and id = v_uuid_candidate
     limit 1;
    if v_recipe_id is not null then
      return v_recipe_id;
    end if;
  exception when others then
    -- Not a UUID, continue to name matching
  end;

  -- Step B: Case-insensitive trimmed match on active current dishes
  select id into v_recipe_id
    from public.recipes
   where business_id = p_biz
     and lower(trim(name)) = lower(trim(p_identifier))
     and is_current = true
   limit 1;

  if v_recipe_id is not null then
    return v_recipe_id;
  end if;

  -- Step C: Fallback match on historical / renamed dish versions
  select id into v_recipe_id
    from public.recipes
   where business_id = p_biz
     and lower(trim(name)) = lower(trim(p_identifier))
   order by created_at desc
   limit 1;

  return v_recipe_id;
end;
$function$;
