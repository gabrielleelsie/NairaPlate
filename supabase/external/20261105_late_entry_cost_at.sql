-- NairaPlate: paper-sale (late entry) food cost at the ACTUAL SALE TIME.
-- Run once in the Supabase SQL editor of the LIVE NairaPlate project, AFTER 20261101_late_entries_a.sql
-- and 20261103_ingredient_prices_a.sql. Safe to re-run.
-- Check afterwards:  20261105_late_entry_cost_at_check.sql
-- Rehearsal:         20261105_late_entry_cost_at_rehearsal.sql (always ends in a red "REHEARSAL DONE" message)
-- Undo:              20261105_late_entry_cost_at_rollback.sql
--
-- Rules:
--  * A paper sale's plate cost uses the ingredient prices in force when the sale actually happened.
--  * If ANY ingredient has no price at that time, the whole plate is "unknown". The owner holds the entry,
--    or explicitly approves it at today's cost with a reason. That choice is stored and labelled as an estimate.
--  * The cost is ALWAYS worked out by the database. A cost sent by an app or typed into SQL is never trusted.
--  * Till sales are unchanged.

begin;

-- 0. Pre-flight: stop without changing anything if a required piece is missing.
do $pre$
begin
  if to_regclass('public.late_entries') is null or to_regclass('public.late_entry_items') is null then
    raise exception 'Run 20261101_late_entries_a.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.ingredient_price_history') is null then
    raise exception 'Run 20261103_ingredient_prices_a.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('public.approve_and_post_late_entry(uuid,text,text)') is null
     and to_regprocedure('public.approve_and_post_late_entry(uuid,text,text,text,text)') is null then
    raise exception 'approve_and_post_late_entry is not the expected version. Nothing was changed.';
  end if;
  if to_regprocedure('public.recipe_plate_cost_kobo(uuid,text)') is null then
    raise exception 'recipe_plate_cost_kobo(uuid, text) is missing. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_items' and column_name='cost_per_plate_kobo')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='is_late_entry') then
    raise exception 'order_items.cost_per_plate_kobo or orders.is_late_entry is missing. Nothing was changed.';
  end if;
end $pre$;

-- 1. Evidence columns on each sold line (null on Till sales).
alter table public.order_items add column if not exists cost_basis text;
alter table public.order_items add column if not exists cost_estimated_at timestamptz;
alter table public.order_items add column if not exists cost_estimated_by uuid;
alter table public.order_items add column if not exists cost_estimation_reason text;
alter table public.order_items add column if not exists cost_unavailable_reason text;
alter table public.order_items add column if not exists cost_unresolved_ingredients jsonb;
alter table public.order_items drop constraint if exists order_items_cost_basis_check;
alter table public.order_items add constraint order_items_cost_basis_check check (
  cost_basis is null
  or cost_basis in ('sale_time_exact','sale_time_backfilled','estimated_current_price','unknown_held','not_applicable'));
alter table public.order_items drop constraint if exists order_items_cost_estimate_evidence;
alter table public.order_items add constraint order_items_cost_estimate_evidence check (
  cost_basis is distinct from 'estimated_current_price'
  or (cost_estimated_at is not null and cost_estimated_by is not null
      and length(btrim(coalesce(cost_estimation_reason,''))) >= 5 and cost_unresolved_ingredients is not null));

-- 2. The owner's cost decision, recorded on the paper entry (append-only table; written only by approval).
alter table public.late_entries add column if not exists cost_decision text;
alter table public.late_entries add column if not exists cost_decided_at timestamptz;
alter table public.late_entries add column if not exists cost_decided_by uuid;
alter table public.late_entries add column if not exists cost_estimate_reason text;
alter table public.late_entries add column if not exists cost_unresolved_ingredients jsonb;
alter table public.late_entries drop constraint if exists late_entries_cost_decision_check;
alter table public.late_entries add constraint late_entries_cost_decision_check check (
  cost_decision is null or cost_decision in ('historical','estimate_current_price'));

-- 3. Plate cost at a moment in time. Internal only: no app can call it.
create or replace function public.recipe_plate_cost_at(p_recipe_id uuid, p_business_id text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r public.recipes%rowtype;
  it record;
  h record;
  v_track text;
  v_total numeric := 0;
  v_unit text; v_base text; v_qty numeric; v_conv numeric;
  v_from numeric; v_to numeric; v_fd text; v_td text;
  v_ok int := 0; v_bad int := 0; v_backfilled boolean := false;
  v_unres jsonb := '[]'::jsonb;
  v_reason text;
begin
  select * into r from public.recipes where id = p_recipe_id and business_id = p_business_id;
  if not found or r.yield_portions is null or r.yield_portions <= 0 then
    return jsonb_build_object('total_cost_per_plate_kobo', null, 'cost_status', 'unknown_held', 'is_complete', false,
      'resolved_ingredient_count', 0, 'unresolved_ingredient_count', 1,
      'unresolved_ingredients', jsonb_build_array(jsonb_build_object('ingredient_id', null, 'ingredient_name', null, 'reason', 'recipe_unavailable')),
      'price_history_basis', 'effective_dated', 'recipe_version_id', p_recipe_id, 'sale_time', p_at, 'calculated_at', now());
  end if;
  v_track := coalesce(r.cost_grade, 'current');

  for it in
    select ri.ingredient_id, ri.quantity, ri.unit, i.base_unit, i.name
      from public.recipe_items ri join public.ingredients i on i.id = ri.ingredient_id
     where ri.recipe_id = r.id
     order by i.name
  loop
    v_reason := null;
    -- quantity in the ingredient's base unit (same rules as recipe_plate_cost_kobo)
    v_unit := lower(trim(it.unit)); v_base := lower(trim(it.base_unit)); v_qty := null;
    if v_unit = v_base then
      v_qty := it.quantity;
    else
      v_conv := null;
      select base_qty into v_conv from public.unit_conversions
       where ingredient_id = it.ingredient_id and lower(trim(market_unit)) = v_unit limit 1;
      if v_conv is not null then
        v_qty := it.quantity * v_conv;
      else
        v_fd := case v_unit when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' end;
        v_td := case v_base when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' end;
        if v_fd is not null and v_fd = v_td then
          v_from := case v_unit when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 else 1000 end;
          v_to   := case v_base when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 else 1000 end;
          v_qty := it.quantity * v_from / v_to;
        end if;
      end if;
    end if;

    if v_qty is null then
      v_reason := 'unit_conversion_unavailable';
    else
      -- exact track only: never another grade's price, never another time's price
      select x.cost_per_base_unit_kobo, x.is_backfilled into h
        from public.ingredient_price_history x
       where x.business_id = p_business_id and x.ingredient_id = it.ingredient_id
         and x.price_track = v_track and x.effective_from <= p_at
       order by x.effective_from desc, x.seq desc
       limit 1;
      if not found then
        if v_track <> 'current' and not exists (select 1 from public.ingredient_price_history x
             where x.business_id = p_business_id and x.ingredient_id = it.ingredient_id and x.price_track = v_track) then
          v_reason := 'grade_history_unavailable';
        else
          v_reason := 'no_price_before_sale_time';
        end if;
      elsif h.cost_per_base_unit_kobo = 0 then
        v_reason := 'no_price_at_time';
      else
        v_total := v_total + v_qty * h.cost_per_base_unit_kobo;
        if h.is_backfilled then v_backfilled := true; end if;
      end if;
    end if;

    if v_reason is null then
      v_ok := v_ok + 1;
    else
      v_bad := v_bad + 1;
      v_unres := v_unres || jsonb_build_array(jsonb_build_object(
        'ingredient_id', it.ingredient_id, 'ingredient_name', it.name, 'price_track', v_track, 'reason', v_reason));
    end if;
  end loop;

  if v_ok + v_bad = 0 then
    v_bad := 1;
    v_unres := jsonb_build_array(jsonb_build_object('ingredient_id', null, 'ingredient_name', null, 'reason', 'recipe_has_no_ingredients'));
  end if;

  return jsonb_build_object(
    'total_cost_per_plate_kobo', case when v_bad = 0 then v_total / r.yield_portions end,
    'cost_status', case when v_bad > 0 then 'unknown_held' when v_backfilled then 'sale_time_backfilled' else 'sale_time_exact' end,
    'is_complete', v_bad = 0,
    'resolved_ingredient_count', v_ok,
    'unresolved_ingredient_count', v_bad,
    'unresolved_ingredients', v_unres,
    'price_history_basis', 'effective_dated',
    'recipe_version_id', r.id,
    'sale_time', p_at,
    'calculated_at', now());
end $function$;
revoke all on function public.recipe_plate_cost_at(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.recipe_plate_cost_at(uuid, text, timestamptz) to service_role;

-- 4. Every new sold line: stamp the version and work out the cost. A supplied cost is always overwritten.
--    Late-entry lines are only accepted inside owner approval (transaction-local flag naming THIS order,
--    plus an owner cost decision recorded on the matching paper entry).
create or replace function public.stamp_recipe_version()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_late boolean; v_csid uuid;
  le public.late_entries%rowtype;
  v_res jsonb; v_today numeric;
begin
  select cur.id into NEW.recipe_version_id
  from recipes picked
  join recipes cur on cur.business_id = picked.business_id and cur.name = picked.name and cur.is_current
  where picked.id = NEW.recipe_id;
  if NEW.recipe_version_id is null then NEW.recipe_version_id := NEW.recipe_id; end if;

  NEW.cost_basis := null; NEW.cost_estimated_at := null; NEW.cost_estimated_by := null;
  NEW.cost_estimation_reason := null; NEW.cost_unavailable_reason := null; NEW.cost_unresolved_ingredients := null;

  select o.is_late_entry, o.client_sale_id into v_late, v_csid from public.orders o where o.id = NEW.order_id;

  if not coalesce(v_late, false) then
    NEW.cost_per_plate_kobo := public.recipe_plate_cost_kobo(NEW.recipe_version_id, NEW.business_id);
    return NEW;
  end if;

  if coalesce(current_setting('app.late_cost', true), '') <> NEW.order_id::text then
    raise exception 'Paper-sale lines can only be created by owner approval.';
  end if;
  select * into le from public.late_entries
   where business_id = NEW.business_id and client_sale_id = v_csid;
  if not found or le.status not in ('submitted','needs_shift_review') or le.posted_order_id is not null
     or le.cost_decided_at is null or le.cost_decision is null then
    raise exception 'Paper-sale lines need an owner cost decision made during approval.';
  end if;

  v_res := public.recipe_plate_cost_at(NEW.recipe_version_id, NEW.business_id, le.actual_sold_at);
  if (v_res ->> 'is_complete')::boolean then
    NEW.cost_per_plate_kobo := (v_res ->> 'total_cost_per_plate_kobo')::numeric;
    NEW.cost_basis := v_res ->> 'cost_status';
  elsif le.cost_decision = 'estimate_current_price' then
    v_today := public.recipe_plate_cost_kobo(NEW.recipe_version_id, NEW.business_id);
    if v_today is null then
      raise exception 'Today''s food cost for this dish cannot be worked out either. Hold this entry.';
    end if;
    NEW.cost_per_plate_kobo := v_today;
    NEW.cost_basis := 'estimated_current_price';
    NEW.cost_estimated_at := le.cost_decided_at;
    NEW.cost_estimated_by := le.cost_decided_by;
    NEW.cost_estimation_reason := le.cost_estimate_reason;
    NEW.cost_unresolved_ingredients := v_res -> 'unresolved_ingredients';
    select string_agg(distinct x ->> 'reason', ', ') into NEW.cost_unavailable_reason
      from jsonb_array_elements(v_res -> 'unresolved_ingredients') x;
  else
    raise exception 'Food cost unknown at the sale time. Hold this entry, or approve it using today''s cost as an estimate.';
  end if;
  return NEW;
end $function$;

-- 5. A sold line's frozen cost and its evidence can never be edited by a user.
create or replace function public.order_items_lock_cost()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if (NEW.cost_per_plate_kobo is distinct from OLD.cost_per_plate_kobo
      or NEW.cost_basis is distinct from OLD.cost_basis
      or NEW.cost_estimated_at is distinct from OLD.cost_estimated_at
      or NEW.cost_estimated_by is distinct from OLD.cost_estimated_by
      or NEW.cost_estimation_reason is distinct from OLD.cost_estimation_reason
      or NEW.cost_unavailable_reason is distinct from OLD.cost_unavailable_reason
      or NEW.cost_unresolved_ingredients is distinct from OLD.cost_unresolved_ingredients)
     and (auth.jwt() -> 'app_metadata' ->> 'business_id') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'The cost of a sold item cannot be changed.';
  end if;
  return NEW;
end $function$;

-- 6. Owner preview: what each paper-sale line would cost at its sale time. Read-only.
create or replace function public.late_entry_cost_preview(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  e public.late_entries%rowtype;
  it record; v_ver uuid; v_res jsonb;
  v_lines jsonb := '[]'::jsonb; v_all boolean := true; v_backfilled boolean := false;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then
    raise exception 'Only business owners can review paper-sale food cost.';
  end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  select * into e from public.late_entries where id = p_id and business_id = v_biz;
  if not found then raise exception 'Late entry record not found.'; end if;

  for it in select * from public.late_entry_items where late_entry_id = p_id order by created_at, id loop
    select cur.id into v_ver
      from recipes picked
      join recipes cur on cur.business_id = picked.business_id and cur.name = picked.name and cur.is_current
     where picked.id = it.recipe_id;
    v_ver := coalesce(v_ver, it.recipe_id);
    v_res := public.recipe_plate_cost_at(v_ver, v_biz, e.actual_sold_at);
    if not (v_res ->> 'is_complete')::boolean then v_all := false; end if;
    if v_res ->> 'cost_status' = 'sale_time_backfilled' then v_backfilled := true; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'dish_name', it.dish_name, 'quantity', it.quantity, 'cost', v_res,
      'today_cost_per_plate_kobo', public.recipe_plate_cost_kobo(v_ver, v_biz)));
  end loop;

  return jsonb_build_object('late_entry_id', p_id, 'actual_sold_at', e.actual_sold_at, 'is_complete', v_all,
    'overall_status', case when not v_all then 'unknown_held' when v_backfilled then 'sale_time_backfilled' else 'sale_time_exact' end,
    'lines', v_lines);
end $function$;
revoke all on function public.late_entry_cost_preview(uuid) from public, anon;
grant execute on function public.late_entry_cost_preview(uuid) to authenticated, service_role;

-- 7. Approval now records the cost decision. Replaces the 3-argument live version (same body otherwise).
drop function if exists public.approve_and_post_late_entry(uuid, text, text);

create or replace function public.approve_and_post_late_entry(
  p_id uuid, p_shift_resolution text default null, p_notes text default null,
  p_cost_decision text default null, p_estimate_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Determine shift context
  select id into v_cur_open_shift from public.cash_drawers where business_id = v_biz and status = 'open' limit 1;

  if e.status = 'needs_shift_review' or v_cur_open_shift is null then
    if p_shift_resolution not in ('closed_shift_included', 'closed_shift_late_cash') then
      raise exception 'Closed-shift entries require an explicit resolution: closed_shift_included or closed_shift_late_cash.';
    end if;
    v_resolution := p_shift_resolution;

    if v_resolution = 'closed_shift_late_cash' and e.cash_kobo > 0 and e.source_shift_id is not null then
      insert into public.cash_drawer_adjustments (
        business_id, drawer_id, amount_kobo, reason, recorded_by
      ) values (
        v_biz, e.source_shift_id, e.cash_kobo,
        format('Late cash from paper ref %s', e.paper_reference), v_uid
      );
    end if;
  else
    v_resolution := 'open_shift_direct';
  end if;

  -- Payment status: pure transfer starts as awaiting_payment
  if e.payment_method = 'transfer' then
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
end $function$;
revoke all on function public.approve_and_post_late_entry(uuid, text, text, text, text) from public, anon;
grant execute on function public.approve_and_post_late_entry(uuid, text, text, text, text) to authenticated, service_role;

commit;
