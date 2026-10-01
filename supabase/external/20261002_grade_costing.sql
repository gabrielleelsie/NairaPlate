-- NairaPlate phase 1b: recipes get a cost grade, and every sale freezes its cost per plate.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261002_grade_costing_rollback.sql

-- 1. A recipe can be costed at grade A, B or C. Empty = latest price (how every recipe works today).
alter table public.recipes add column if not exists cost_grade text;
alter table public.recipes drop constraint if exists recipes_cost_grade_check;
alter table public.recipes add constraint recipes_cost_grade_check check (cost_grade is null or cost_grade in ('A','B','C'));

-- 2. Each sold line remembers what one plate cost at the moment of sale. Old rows stay empty (estimated later).
alter table public.order_items add column if not exists cost_per_plate_kobo numeric;

-- 3. Cost of one plate of a recipe version, at its cost grade. Same rules as computeRecipeCost() in src/lib/costing.ts:
--    convert each line to the ingredient's base unit, multiply by the price, add up, divide by plates made.
--    Returns null (never 0) if any line cannot be converted. Internal: only called by the trigger below.
create or replace function public.recipe_plate_cost_kobo(p_recipe_id uuid, p_business_id text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  r public.recipes%ROWTYPE;
  it record;
  v_total numeric := 0;
  v_unit text; v_base text; v_qty numeric; v_conv numeric; v_price numeric;
  v_from numeric; v_to numeric; v_fd text; v_td text;
BEGIN
  SELECT * INTO r FROM public.recipes WHERE id = p_recipe_id AND business_id = p_business_id;
  IF NOT FOUND OR r.yield_portions IS NULL OR r.yield_portions <= 0 THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipe_items WHERE recipe_id = r.id) THEN RETURN NULL; END IF;

  FOR it IN
    SELECT ri.ingredient_id, ri.quantity, ri.unit, i.base_unit, i.current_cost_kobo
      FROM public.recipe_items ri JOIN public.ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = r.id
  LOOP
    v_unit := lower(trim(it.unit)); v_base := lower(trim(it.base_unit)); v_qty := NULL;
    IF v_unit = v_base THEN
      v_qty := it.quantity;
    ELSE
      v_conv := NULL;
      SELECT base_qty INTO v_conv FROM public.unit_conversions
       WHERE ingredient_id = it.ingredient_id AND lower(trim(market_unit)) = v_unit LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty := it.quantity * v_conv;
      ELSE
        v_fd := CASE v_unit WHEN 'g' THEN 'mass' WHEN 'kg' THEN 'mass' WHEN 'ml' THEN 'volume' WHEN 'l' THEN 'volume' END;
        v_td := CASE v_base WHEN 'g' THEN 'mass' WHEN 'kg' THEN 'mass' WHEN 'ml' THEN 'volume' WHEN 'l' THEN 'volume' END;
        IF v_fd IS NOT NULL AND v_fd = v_td THEN
          v_from := CASE v_unit WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'ml' THEN 1 ELSE 1000 END;
          v_to   := CASE v_base WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 WHEN 'ml' THEN 1 ELSE 1000 END;
          v_qty := it.quantity * v_from / v_to;
        END IF;
      END IF;
    END IF;
    IF v_qty IS NULL THEN RETURN NULL; END IF;

    v_price := NULL;
    IF r.cost_grade IS NOT NULL THEN
      SELECT cost_kobo INTO v_price FROM public.ingredient_grade_prices
       WHERE ingredient_id = it.ingredient_id AND grade = r.cost_grade;
    END IF;
    v_total := v_total + v_qty * coalesce(v_price, it.current_cost_kobo);   -- no price for that grade: latest price
  END LOOP;

  RETURN v_total / r.yield_portions;
END;
$function$;
revoke all on function public.recipe_plate_cost_kobo(uuid, text) from public, anon, authenticated;

-- 4. Stamp the version (as before) AND freeze the cost, on every new sold line.
--    Runs as the function owner so it can read the recipe, even for a cashier.
create or replace function public.stamp_recipe_version()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  SELECT cur.id INTO NEW.recipe_version_id
  FROM recipes picked
  JOIN recipes cur ON cur.business_id = picked.business_id AND cur.name = picked.name AND cur.is_current
  WHERE picked.id = NEW.recipe_id;
  IF NEW.recipe_version_id IS NULL THEN NEW.recipe_version_id := NEW.recipe_id; END IF;
  NEW.cost_per_plate_kobo := public.recipe_plate_cost_kobo(NEW.recipe_version_id, NEW.business_id);
  RETURN NEW;
END $function$;

-- 5. A sold line's frozen cost can never be edited by a user.
create or replace function public.order_items_lock_cost()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
BEGIN
  IF NEW.cost_per_plate_kobo IS DISTINCT FROM OLD.cost_per_plate_kobo
     AND (auth.jwt() -> 'app_metadata' ->> 'business_id') IS NOT NULL
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'The cost of a sold item cannot be changed.';
  END IF;
  RETURN NEW;
END $function$;
drop trigger if exists order_items_lock_cost on public.order_items;
create trigger order_items_lock_cost before update on public.order_items
  for each row execute function public.order_items_lock_cost();

-- 6. save_recipe_version takes the cost grade. The old 6-argument version is replaced.
drop function if exists public.save_recipe_version(uuid, text, text, numeric, bigint, jsonb);

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

  INSERT INTO recipes (business_id, name, category, yield_portions, selling_price_kobo, notes, version_number, is_current, cost_grade)
  VALUES (v_old.business_id, trim(p_name), nullif(trim(coalesce(p_category, '')), ''), p_yield_portions,
          p_selling_price_kobo, v_old.notes, v_old.version_number + 1, true, p_cost_grade)
  RETURNING id INTO v_new_id;

  INSERT INTO recipe_items (business_id, recipe_id, ingredient_id, quantity, unit)
  SELECT v_old.business_id, v_new_id, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit'
  FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('old_id', v_old.id, 'new_id', v_new_id, 'version_number', v_old.version_number + 1);
END $function$;
