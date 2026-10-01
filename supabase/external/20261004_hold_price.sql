-- NairaPlate "Hold my price": an owner-set minimum quantity per ingredient line, and a never-cut flag.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261004_hold_price_rollback.sql
-- Empty minimum = that line is never trimmed, so nothing changes for any existing recipe.

alter table public.recipe_items add column if not exists min_quantity numeric;
alter table public.recipe_items drop constraint if exists recipe_items_min_quantity_check;
alter table public.recipe_items add constraint recipe_items_min_quantity_check check (min_quantity is null or min_quantity >= 0);
alter table public.recipe_items add column if not exists never_cut boolean not null default false;

-- save_recipe_version keeps the same arguments; each item in p_items may now also carry min_quantity and never_cut.
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

  INSERT INTO recipe_items (business_id, recipe_id, ingredient_id, quantity, unit, min_quantity, never_cut)
  SELECT v_old.business_id, v_new_id, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit',
         nullif(x->>'min_quantity', '')::numeric, coalesce((x->>'never_cut')::boolean, false)
  FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('old_id', v_old.id, 'new_id', v_new_id, 'version_number', v_old.version_number + 1);
END $function$;
