-- UNDO for 20261105_late_entry_cost_at.sql. Restores the exact live versions captured on 5 Oct 2026.
-- WARNING: permanently removes the food-cost labels and estimate evidence stored on paper-sale lines and entries.
-- Frozen plate costs (cost_per_plate_kobo) on already-posted sales are kept unchanged.
begin;

drop function if exists public.approve_and_post_late_entry(uuid, text, text, text, text);
drop function if exists public.late_entry_cost_preview(uuid);

CREATE OR REPLACE FUNCTION public.approve_and_post_late_entry(p_id uuid, p_shift_resolution text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_biz         text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role        text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid         uuid := auth.uid();
  e             public.late_entries%rowtype;
  v_order_id    uuid;
  v_cur_open_shift uuid;
  it            record;
  v_order_stat  text := 'paid';
  v_resolution  text;
BEGIN
  IF v_biz IS NULL OR v_role NOT IN ('owner', 'supa_admin') THEN
    RAISE EXCEPTION 'Only business owners can approve and post late entries.';
  END IF;
  IF NOT (SELECT public.business_has_access(v_biz)) THEN
    RAISE EXCEPTION 'Your plan has ended.';
  END IF;

  SELECT * INTO e FROM public.late_entries WHERE id = p_id AND business_id = v_biz FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Late entry record not found.';
  END IF;
  IF e.status = 'posted' THEN
    RETURN jsonb_build_object('order_id', e.posted_order_id, 'already_posted', true);
  END IF;
  IF e.status NOT IN ('submitted', 'needs_shift_review') THEN
    RAISE EXCEPTION 'This late entry is % and cannot be approved.', e.status;
  END IF;

  -- Determine shift context
  SELECT id INTO v_cur_open_shift FROM public.cash_drawers WHERE business_id = v_biz AND status = 'open' LIMIT 1;

  IF e.status = 'needs_shift_review' OR v_cur_open_shift IS NULL THEN
    IF p_shift_resolution NOT IN ('closed_shift_included', 'closed_shift_late_cash') THEN
      RAISE EXCEPTION 'Closed-shift entries require an explicit resolution: closed_shift_included or closed_shift_late_cash.';
    END IF;
    v_resolution := p_shift_resolution;

    IF v_resolution = 'closed_shift_late_cash' AND e.cash_kobo > 0 AND e.source_shift_id IS NOT NULL THEN
      INSERT INTO public.cash_drawer_adjustments (
        business_id, drawer_id, amount_kobo, reason, recorded_by
      ) VALUES (
        v_biz, e.source_shift_id, e.cash_kobo,
        format('Late cash from paper ref %s', e.paper_reference), v_uid
      );
    END IF;
  ELSE
    v_resolution := 'open_shift_direct';
  END IF;

  -- Payment status: pure transfer starts as awaiting_payment (valid in orders_status_check_v2)
  IF e.payment_method = 'transfer' THEN
    v_order_stat := 'awaiting_payment';
  ELSE
    v_order_stat := 'paid';
  END IF;

  -- 1. Create authoritative order in public.orders
  PERFORM set_config('app.payment_internal', '1', true);
  INSERT INTO public.orders (
    business_id, channel, price_tier, subtotal_kobo, total_kobo,
    status, payment_method, cash_amount_kobo, transfer_amount_kobo,
    created_by, client_sale_id, is_late_entry, actual_sold_at,
    paper_reference, late_delay_seconds, late_entered_by, late_approved_by
  ) VALUES (
    v_biz, e.channel, e.price_tier, e.total_kobo, e.total_kobo,
    v_order_stat, e.payment_method, e.cash_kobo, e.transfer_kobo,
    e.entered_by, e.client_sale_id, true, e.actual_sold_at,
    e.paper_reference, e.delay_seconds, e.entered_by, v_uid
  ) RETURNING id INTO v_order_id;
  PERFORM set_config('app.payment_internal', '', true);

  -- 2. Insert authoritative order items
  FOR it IN SELECT * FROM public.late_entry_items WHERE late_entry_id = p_id LOOP
    INSERT INTO public.order_items (
      business_id, order_id, recipe_id, quantity, unit_price_kobo
    ) VALUES (
      v_biz, v_order_id, it.recipe_id, it.quantity, it.unit_price_kobo
    );
  END LOOP;

  -- 3. Mark late entry posted (using "notes" column)
  PERFORM set_config('app.late_internal', '1', true);
  UPDATE public.late_entries
     SET status = 'posted',
         posted_order_id = v_order_id,
         approved_by = v_uid,
         approved_at = now(),
         shift_resolution = v_resolution,
         notes = coalesce(p_notes, notes)
   WHERE id = p_id;
  PERFORM set_config('app.late_internal', '', true);

  -- 4. Audit log
  INSERT INTO public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    v_biz, v_uid, v_role, 'late_entry_posted', 'orders', v_order_id,
    format('Late entry "%s" approved & posted as Order #%s (%s)', e.paper_reference, v_order_id, v_resolution)
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'late_entry_id', p_id,
    'status', 'posted',
    'already_posted', false
  );
END;
$function$;
revoke all on function public.approve_and_post_late_entry(uuid, text, text) from public, anon;
grant execute on function public.approve_and_post_late_entry(uuid, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stamp_recipe_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  SELECT cur.id INTO NEW.recipe_version_id
  FROM recipes picked
  JOIN recipes cur ON cur.business_id = picked.business_id AND cur.name = picked.name AND cur.is_current
  WHERE picked.id = NEW.recipe_id;
  IF NEW.recipe_version_id IS NULL THEN NEW.recipe_version_id := NEW.recipe_id; END IF;
  NEW.cost_per_plate_kobo := public.recipe_plate_cost_kobo(NEW.recipe_version_id, NEW.business_id);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.order_items_lock_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cost_per_plate_kobo IS DISTINCT FROM OLD.cost_per_plate_kobo
     AND (auth.jwt() -> 'app_metadata' ->> 'business_id') IS NOT NULL
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'The cost of a sold item cannot be changed.';
  END IF;
  RETURN NEW;
END $function$;

drop function if exists public.recipe_plate_cost_at(uuid, text, timestamptz);

alter table public.order_items drop constraint if exists order_items_cost_estimate_evidence;
alter table public.order_items drop constraint if exists order_items_cost_basis_check;
alter table public.order_items drop column if exists cost_basis;
alter table public.order_items drop column if exists cost_estimated_at;
alter table public.order_items drop column if exists cost_estimated_by;
alter table public.order_items drop column if exists cost_estimation_reason;
alter table public.order_items drop column if exists cost_unavailable_reason;
alter table public.order_items drop column if exists cost_unresolved_ingredients;

alter table public.late_entries drop constraint if exists late_entries_cost_decision_check;
alter table public.late_entries drop column if exists cost_decision;
alter table public.late_entries drop column if exists cost_decided_at;
alter table public.late_entries drop column if exists cost_decided_by;
alter table public.late_entries drop column if exists cost_estimate_reason;
alter table public.late_entries drop column if exists cost_unresolved_ingredients;

commit;
