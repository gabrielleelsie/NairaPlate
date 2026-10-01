-- Undo phase 1b: restores the old stamp_recipe_version and the 6-argument save_recipe_version, drops the new pieces.
drop trigger if exists order_items_lock_cost on public.order_items;
drop function if exists public.order_items_lock_cost();

create or replace function public.stamp_recipe_version()
returns trigger language plpgsql set search_path to 'public'
as $function$
BEGIN
  SELECT cur.id INTO NEW.recipe_version_id
  FROM recipes picked
  JOIN recipes cur ON cur.business_id = picked.business_id AND cur.name = picked.name AND cur.is_current
  WHERE picked.id = NEW.recipe_id;
  IF NEW.recipe_version_id IS NULL THEN NEW.recipe_version_id := NEW.recipe_id; END IF;
  RETURN NEW;
END $function$;

drop function if exists public.recipe_plate_cost_kobo(uuid, text);
drop function if exists public.save_recipe_version(uuid, text, text, numeric, bigint, jsonb, text);

create or replace function public.save_recipe_version(p_recipe_id uuid, p_name text, p_category text, p_yield_portions numeric, p_selling_price_kobo bigint, p_items jsonb)
returns jsonb language plpgsql set search_path to 'public'
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

  IF v_role NOT IN ('owner', 'supa_admin') AND EXISTS (
    SELECT 1 FROM recipe_items ri WHERE ri.recipe_id = v_old.id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE (x->>'ingredient_id')::uuid = ri.ingredient_id)
  ) THEN
    RAISE EXCEPTION 'Only an owner can remove ingredients from a saved recipe.';
  END IF;

  UPDATE recipes SET is_current = false, superseded_at = now() WHERE id = v_old.id;

  INSERT INTO recipes (business_id, name, category, yield_portions, selling_price_kobo, notes, version_number, is_current)
  VALUES (v_old.business_id, trim(p_name), nullif(trim(coalesce(p_category, '')), ''), p_yield_portions,
          p_selling_price_kobo, v_old.notes, v_old.version_number + 1, true)
  RETURNING id INTO v_new_id;

  INSERT INTO recipe_items (business_id, recipe_id, ingredient_id, quantity, unit)
  SELECT v_old.business_id, v_new_id, (x->>'ingredient_id')::uuid, (x->>'quantity')::numeric, x->>'unit'
  FROM jsonb_array_elements(p_items) x;

  RETURN jsonb_build_object('old_id', v_old.id, 'new_id', v_new_id, 'version_number', v_old.version_number + 1);
END $function$;

-- Frozen costs already stored are kept (data), so the column is left in place. To remove everything:
--   alter table public.order_items drop column if exists cost_per_plate_kobo;
--   alter table public.recipes drop constraint if exists recipes_cost_grade_check;
--   alter table public.recipes drop column if exists cost_grade;
