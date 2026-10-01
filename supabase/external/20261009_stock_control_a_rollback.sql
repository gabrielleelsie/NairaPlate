-- Undo stock control part A. Stock figures stay as they are now; the stock record (history of changes) is dropped.
drop trigger if exists wastage_logs_restore_stock on public.wastage_logs;
drop trigger if exists wastage_logs_apply_stock on public.wastage_logs;
drop function if exists public.apply_wastage_stock();
drop trigger if exists batches_stock_mode_check on public.batches;
drop function if exists public.check_batch_stock_mode();
drop trigger if exists orders_reverse_stock on public.orders;
drop function if exists public.reverse_sale_stock();
drop trigger if exists order_items_apply_stock on public.order_items;
drop function if exists public.apply_sale_stock();
drop trigger if exists ingredients_log_stock on public.ingredients;
drop function if exists public.log_stock_movement();
drop function if exists public.to_base_qty(uuid, numeric, text);
-- save_recipe_version goes back to the variants version (no stock setting), then the column is dropped.
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

  INSERT INTO recipes (business_id, name, category, yield_portions, selling_price_kobo, notes, version_number, is_current, cost_grade, dish_id)
  VALUES (v_old.business_id, trim(p_name), nullif(trim(coalesce(p_category, '')), ''), p_yield_portions,
          p_selling_price_kobo, v_old.notes, v_old.version_number + 1, true, p_cost_grade, coalesce(v_old.dish_id, v_old.id))
  RETURNING id INTO v_new_id;

  INSERT INTO recipe_items (business_id, recipe_id, ingredient_id, quantity, unit, min_quantity, never_cut)
  SELECT v_old.business_id, v_new_id, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit',
         nullif(x->>'min_quantity', '')::numeric, coalesce((x->>'never_cut')::boolean, false)
  FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('old_id', v_old.id, 'new_id', v_new_id, 'version_number', v_old.version_number + 1);
END $function$;

alter table public.recipes drop constraint if exists recipes_stock_mode_check;
alter table public.recipes drop column if exists stock_mode;
drop table if exists public.stock_movements;
-- log_purchase goes back to the version without the stock label.
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
