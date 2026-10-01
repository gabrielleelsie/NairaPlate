-- NairaPlate stock control, part A: a stock record (ledger), wastage and sales reduce stock, and a per-dish stock setting.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261009_stock_control_a_rollback.sql
-- Nothing changes for any dish until an owner chooses "Made to order" for it: dishes with no setting behave as today.

-- 1. The stock record: every change to an ingredient's stock is written here with its reason, who did it, and the balance after.
create table if not exists public.stock_movements (
  id            uuid        primary key default gen_random_uuid(),
  business_id   text        not null references public.businesses(id) on delete cascade,
  ingredient_id uuid        not null references public.ingredients(id) on delete cascade,
  qty_base      numeric     not null,          -- + adds stock, - takes stock away, in the ingredient's base unit
  balance_after numeric     not null,
  reason        text        not null,          -- purchase, batch_use, sale_use, sale_void, wastage, wastage_removed, count_correction, opening_count, opening_balance, unlabelled
  ref_id        uuid,                          -- the sold item, batch, wastage entry or count line behind it, when there is one
  recorded_by   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists stock_movements_ing_idx on public.stock_movements (ingredient_id, created_at desc);
create index if not exists stock_movements_biz_idx on public.stock_movements (business_id, created_at desc);
create index if not exists stock_movements_ref_idx on public.stock_movements (ref_id);
alter table public.stock_movements enable row level security;
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (
    business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id')))
  );
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to authenticated;
grant all on public.stock_movements to service_role;

-- Opening balance: whatever stock each ingredient already shows becomes the first line, so the record adds up from day one.
-- (Done before the automatic recording is switched on, so it is not counted twice.)
insert into public.stock_movements (business_id, ingredient_id, qty_base, balance_after, reason)
select i.business_id, i.id, i.stock_base_qty, i.stock_base_qty, 'opening_balance'
  from public.ingredients i
 where i.stock_base_qty <> 0
   and not exists (select 1 from public.stock_movements m where m.ingredient_id = i.id);

-- 2. Automatic recording. Any change to stock_base_qty writes a line. The code that changes stock says why by
-- setting app.stock_reason (and app.stock_ref) first; a change made any other way is recorded as "unlabelled", so it shows up.
create or replace function public.log_stock_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reason text := coalesce(nullif(current_setting('app.stock_reason', true), ''), 'unlabelled');
  v_ref uuid;
begin
  begin v_ref := nullif(current_setting('app.stock_ref', true), '')::uuid; exception when others then v_ref := null; end;
  insert into public.stock_movements (business_id, ingredient_id, qty_base, balance_after, reason, ref_id, recorded_by)
  values (NEW.business_id, NEW.id, NEW.stock_base_qty - OLD.stock_base_qty, NEW.stock_base_qty, v_reason, v_ref, auth.uid());
  return NEW;
end $function$;
drop trigger if exists ingredients_log_stock on public.ingredients;
create trigger ingredients_log_stock after update of stock_base_qty on public.ingredients
  for each row when (OLD.stock_base_qty is distinct from NEW.stock_base_qty)
  execute function public.log_stock_movement();

-- 3. Quantity in the ingredient's base unit: same rules as toBaseQty() in src/lib/costing.ts. Internal only.
create or replace function public.to_base_qty(p_ingredient_id uuid, p_qty numeric, p_unit text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_base text; v_unit text := lower(trim(p_unit)); v_conv numeric; v_fd text; v_td text; v_from numeric; v_to numeric;
begin
  select lower(trim(base_unit)) into v_base from public.ingredients where id = p_ingredient_id;
  if v_base is null then return null; end if;
  if v_unit = v_base then return p_qty; end if;
  select base_qty into v_conv from public.unit_conversions
   where ingredient_id = p_ingredient_id and lower(trim(market_unit)) = v_unit limit 1;
  if v_conv is not null then return p_qty * v_conv; end if;
  v_fd := case v_unit when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' end;
  v_td := case v_base when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' end;
  if v_fd is not null and v_fd = v_td then
    v_from := case v_unit when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 else 1000 end;
    v_to   := case v_base when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 else 1000 end;
    return p_qty * v_from / v_to;
  end if;
  return null;
end $function$;
revoke all on function public.to_base_qty(uuid, numeric, text) from public, anon, authenticated;

-- 4. Per-dish stock setting. Empty = not chosen yet (the dish does not change stock when sold, as before).
alter table public.recipes add column if not exists stock_mode text;
alter table public.recipes drop constraint if exists recipes_stock_mode_check;
alter table public.recipes add constraint recipes_stock_mode_check check (stock_mode is null or stock_mode in ('made_to_order','batch'));

-- A new version of a dish keeps its stock setting.
create or replace function public.save_recipe_version(
  p_recipe_id uuid, p_name text, p_category text, p_yield_portions numeric, p_selling_price_kobo bigint,
  p_items jsonb, p_cost_grade text default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_old recipes%ROWTYPE;
  v_new_id uuid;
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
BEGIN
  SELECT * INTO v_old FROM recipes WHERE id = p_recipe_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found.'; END IF;
  IF NOT v_old.is_current THEN RAISE EXCEPTION 'This is an old version. Reload the Recipes screen and edit the current one.'; END IF;
  IF p_yield_portions IS NULL OR p_yield_portions <= 0 THEN RAISE EXCEPTION 'Yield must be at least 1 plate.'; END IF;
  IF p_selling_price_kobo IS NULL OR p_selling_price_kobo <= 0 THEN RAISE EXCEPTION 'Price must be more than zero.'; END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one ingredient.'; END IF;
  IF p_cost_grade IS NOT NULL AND p_cost_grade NOT IN ('A','B','C') THEN RAISE EXCEPTION 'Grade must be A, B or C.'; END IF;

  IF v_role NOT IN ('owner', 'supa_admin') AND EXISTS (
    SELECT 1 FROM recipe_items ri WHERE ri.recipe_id = v_old.id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE (x->>'ingredient_id')::uuid = ri.ingredient_id)
  ) THEN
    RAISE EXCEPTION 'Only an owner can remove ingredients from a saved recipe.';
  END IF;

  UPDATE recipes SET is_current = false, superseded_at = now() WHERE id = v_old.id;

  INSERT INTO recipes (business_id, name, category, yield_portions, selling_price_kobo, notes, version_number, is_current, cost_grade, dish_id, stock_mode)
  VALUES (v_old.business_id, trim(p_name), nullif(trim(coalesce(p_category, '')), ''), p_yield_portions,
          p_selling_price_kobo, v_old.notes, v_old.version_number + 1, true, p_cost_grade, coalesce(v_old.dish_id, v_old.id), v_old.stock_mode)
  RETURNING id INTO v_new_id;

  INSERT INTO recipe_items (business_id, recipe_id, ingredient_id, quantity, unit, min_quantity, never_cut)
  SELECT v_old.business_id, v_new_id, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit',
         nullif(x->>'min_quantity', '')::numeric, coalesce((x->>'never_cut')::boolean, false)
  FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('old_id', v_old.id, 'new_id', v_new_id, 'version_number', v_old.version_number + 1);
END $function$;

-- 5. Made-to-order dishes: stock goes down when a plate is sold, using that dish version's recipe.
create or replace function public.apply_sale_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r public.recipes%rowtype; it record; v_qty numeric;
begin
  select * into r from public.recipes where id = NEW.recipe_version_id;
  if not found or r.stock_mode is distinct from 'made_to_order' or r.yield_portions is null or r.yield_portions <= 0 then return NEW; end if;
  perform set_config('app.stock_reason', 'sale_use', true);
  perform set_config('app.stock_ref', NEW.id::text, true);
  for it in select ingredient_id, quantity, unit from public.recipe_items where recipe_id = r.id loop
    v_qty := public.to_base_qty(it.ingredient_id, it.quantity, it.unit);
    if v_qty is null then continue; end if;
    update public.ingredients set stock_base_qty = stock_base_qty - (v_qty * NEW.quantity / r.yield_portions)
     where id = it.ingredient_id and business_id = NEW.business_id;
  end loop;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_ref', '', true);
  return NEW;
end $function$;
drop trigger if exists order_items_apply_stock on public.order_items;
create trigger order_items_apply_stock after insert on public.order_items
  for each row execute function public.apply_sale_stock();

-- A voided (cancelled) order puts back exactly what its sold items took. A refund does not: the food was already used.
create or replace function public.reverse_sale_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m record;
begin
  for m in
    select sm.ingredient_id, sm.qty_base, sm.ref_id
      from public.stock_movements sm join public.order_items oi on oi.id = sm.ref_id
     where oi.order_id = NEW.id and sm.reason = 'sale_use'
       and not exists (select 1 from public.stock_movements v where v.reason = 'sale_void' and v.ref_id = sm.ref_id and v.ingredient_id = sm.ingredient_id)
  loop
    perform set_config('app.stock_reason', 'sale_void', true);
    perform set_config('app.stock_ref', m.ref_id::text, true);
    update public.ingredients set stock_base_qty = stock_base_qty - m.qty_base where id = m.ingredient_id;
  end loop;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_ref', '', true);
  return NEW;
end $function$;
drop trigger if exists orders_reverse_stock on public.orders;
create trigger orders_reverse_stock after update of status on public.orders
  for each row when (NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled')
  execute function public.reverse_sale_stock();

-- 6. Batches: label the stock change, and stop a made-to-order dish from being counted twice (once when cooked, once when sold).
create or replace function public.check_batch_stock_mode()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.recipes where id = NEW.recipe_id and stock_mode = 'made_to_order') then
    raise exception 'This dish is set to Made to order, so its stock goes down when it is sold. Change it to Cooked in batches if you want to log batches.';
  end if;
  perform set_config('app.stock_reason', 'batch_use', true);
  perform set_config('app.stock_ref', NEW.id::text, true);
  return NEW;
end $function$;
drop trigger if exists batches_stock_mode_check on public.batches;
create trigger batches_stock_mode_check before insert on public.batches
  for each row execute function public.check_batch_stock_mode();

-- 7. Wastage takes stock away, and putting a wastage entry back (deleting it) puts the stock back.
create or replace function public.apply_wastage_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_qty numeric; m record;
begin
  if TG_OP = 'INSERT' then
    v_qty := public.to_base_qty(NEW.ingredient_id, NEW.qty, NEW.unit);
    if v_qty is null then raise exception 'No unit conversion for this ingredient, so the wastage cannot be taken off stock. Add one on the Ingredients screen.'; end if;
    perform set_config('app.stock_reason', 'wastage', true);
    perform set_config('app.stock_ref', NEW.id::text, true);
    update public.ingredients set stock_base_qty = stock_base_qty - v_qty where id = NEW.ingredient_id and business_id = NEW.business_id;
    perform set_config('app.stock_reason', '', true);
    perform set_config('app.stock_ref', '', true);
    return NEW;
  end if;
  for m in select ingredient_id, qty_base from public.stock_movements where reason = 'wastage' and ref_id = OLD.id loop
    perform set_config('app.stock_reason', 'wastage_removed', true);
    perform set_config('app.stock_ref', OLD.id::text, true);
    update public.ingredients set stock_base_qty = stock_base_qty - m.qty_base where id = m.ingredient_id;
  end loop;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_ref', '', true);
  return OLD;
end $function$;
drop trigger if exists wastage_logs_apply_stock on public.wastage_logs;
create trigger wastage_logs_apply_stock after insert on public.wastage_logs
  for each row execute function public.apply_wastage_stock();
drop trigger if exists wastage_logs_restore_stock on public.wastage_logs;
create trigger wastage_logs_restore_stock after delete on public.wastage_logs
  for each row execute function public.apply_wastage_stock();

-- 8. log_purchase: the same function as before, with one added line that labels its stock change as a purchase.
drop function if exists public.log_purchase(uuid, numeric, text, bigint, text, text, text, text, uuid);
create or replace function public.log_purchase(
  p_ingredient_id uuid, p_qty numeric, p_market_unit text, p_total_kobo bigint, p_payment_method text,
  p_grade text, p_season text, p_raw_transcript text default null, p_supplier_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_ing  public.ingredients%ROWTYPE;
  v_unit text := lower(trim(p_market_unit));
  v_base text;
  v_base_qty numeric;
  v_conv numeric;
  v_new bigint;
  v_pid uuid;
  v_flag boolean := false;
  v_pct numeric;
  v_sup text;
  v_compare bigint;
  v_note text;
BEGIN
  IF v_biz IS NULL OR v_role IS NULL OR v_role NOT IN ('owner','supa_admin','purchaser') THEN
    RAISE EXCEPTION 'Only purchasers and owners can log purchases.';
  END IF;
  IF p_payment_method NOT IN ('cash','transfer','credit') THEN
    RAISE EXCEPTION 'Payment method must be cash, transfer or credit.';
  END IF;
  IF p_grade IS NULL OR p_grade NOT IN ('A','B','C') THEN
    RAISE EXCEPTION 'Choose a grade: A, B or C.';
  END IF;
  IF p_season IS NULL OR p_season NOT IN ('plenty','normal','scarce') THEN
    RAISE EXCEPTION 'Choose a season: Plenty, Normal or Scarce.';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than 0.'; END IF;
  IF p_total_kobo IS NULL OR p_total_kobo <= 0 THEN RAISE EXCEPTION 'Amount paid must be more than 0.'; END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT name INTO v_sup FROM public.suppliers WHERE id = p_supplier_id AND business_id = v_biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found.'; END IF;
  END IF;

  SELECT * INTO v_ing FROM public.ingredients
   WHERE id = p_ingredient_id AND business_id = v_biz
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient not found.'; END IF;

  v_base := lower(trim(v_ing.base_unit));

  -- Same rules as toBaseQty() in src/lib/costing.ts
  IF v_unit = v_base THEN
    v_base_qty := p_qty;
  ELSE
    SELECT base_qty INTO v_conv FROM public.unit_conversions
     WHERE ingredient_id = v_ing.id AND business_id = v_biz AND lower(trim(market_unit)) = v_unit
     LIMIT 1;
    IF v_conv IS NOT NULL THEN
      v_base_qty := p_qty * v_conv;
    ELSIF v_unit = 'g'  AND v_base = 'kg' THEN v_base_qty := p_qty / 1000;
    ELSIF v_unit = 'kg' AND v_base = 'g'  THEN v_base_qty := p_qty * 1000;
    ELSIF v_unit = 'ml' AND v_base = 'l'  THEN v_base_qty := p_qty / 1000;
    ELSIF v_unit = 'l'  AND v_base = 'ml' THEN v_base_qty := p_qty * 1000;
    ELSE
      RAISE EXCEPTION 'No conversion for "%" on % (base unit %). Add one on the Ingredients screen.',
        p_market_unit, v_ing.name, v_ing.base_unit;
    END IF;
  END IF;
  IF v_base_qty IS NULL OR v_base_qty <= 0 THEN RAISE EXCEPTION 'Converted quantity is zero.'; END IF;

  v_new := round(p_total_kobo / v_base_qty);

  -- What to compare this price with: the last price of the SAME grade. If this grade has never been
  -- bought, there is nothing like-for-like to compare with (unless the ingredient has no grade history at all).
  SELECT cost_kobo INTO v_compare FROM public.ingredient_grade_prices
   WHERE ingredient_id = v_ing.id AND grade = p_grade;
  IF v_compare IS NULL THEN
    IF v_ing.current_grade IS NULL THEN
      v_compare := v_ing.current_cost_kobo;          -- old ingredient with no grade history: as before
    ELSE
      v_note := 'first_of_grade';                    -- a different grade was bought last time
    END IF;
  END IF;

  -- previous_cost_kobo only ever receives what was in current_cost_kobo a moment before.
  PERFORM set_config('app.stock_reason', 'purchase', true);   -- the stock record labels this change
  UPDATE public.ingredients
     SET previous_cost_kobo = current_cost_kobo,
         current_cost_kobo  = v_new,
         current_grade      = p_grade,
         current_season     = p_season,
         stock_base_qty     = stock_base_qty + v_base_qty,
         price_updated_at   = now()
   WHERE id = v_ing.id;

  INSERT INTO public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
  VALUES (v_ing.id, v_biz, p_grade, v_new, p_season, now())
  ON CONFLICT (ingredient_id, grade) DO UPDATE SET cost_kobo = EXCLUDED.cost_kobo, season = EXCLUDED.season, updated_at = now();

  INSERT INTO public.purchases
    (business_id, ingredient_id, qty, market_unit, total_kobo, payment_method, recorded_by, recorded_at, raw_transcript, supplier_id, grade, season)
  VALUES
    (v_biz, v_ing.id, p_qty, p_market_unit, p_total_kobo, p_payment_method, auth.uid(), now(), p_raw_transcript, p_supplier_id, p_grade, p_season)
  RETURNING id INTO v_pid;

  -- Bought on credit from a named supplier: record what we now owe them, in this same transaction.
  IF p_supplier_id IS NOT NULL AND p_payment_method = 'credit' THEN
    INSERT INTO public.supplier_transactions (business_id, supplier_id, type, amount_kobo, purchase_id, note, recorded_by)
    VALUES (v_biz, p_supplier_id, 'purchase_on_credit', p_total_kobo, v_pid,
            format('%s %s %s', p_qty, p_market_unit, v_ing.name), auth.uid());
  END IF;

  IF v_compare IS NOT NULL AND v_compare > 0 AND v_new > v_compare * 1.05 THEN
    v_flag := true;
    v_pct := round((v_new - v_compare) * 100.0 / v_compare, 1);
    INSERT INTO public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
    VALUES (v_biz, 'cr_spike', 'warn',
      format('%s (grade %s, %s season) price rose from ₦%s to ₦%s per %s (+%s%%).',
        v_ing.name, p_grade, p_season, to_char(v_compare / 100.0, 'FM999,999,990.00'),
        to_char(v_new / 100.0, 'FM999,999,990.00'), v_ing.base_unit, v_pct),
      'owner', false);
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', v_pid, 'base_qty', v_base_qty,
    'previous_cost_kobo', v_ing.current_cost_kobo, 'current_cost_kobo', v_new,
    'flagged', v_flag, 'pct', v_pct,
    'grade', p_grade, 'season', p_season, 'previous_grade', v_ing.current_grade, 'compared_with_kobo', v_compare, 'note', v_note);
END;
$function$;
