-- NairaPlate recipe variants: named ingredient lists for a dish (for example "Standard" and "Lean season"), owner only.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261007_variants_rollback.sql
-- Variants are only SAVED lists. A dish changes only when an owner switches to one, which saves a normal new recipe version.

-- 1. dish_id: the same on every version of a dish, so variants follow the dish through versions and renames.
alter table public.recipes add column if not exists dish_id uuid;
update public.recipes r set dish_id = coalesce(
  (select r1.id from public.recipes r1 where r1.business_id = r.business_id and r1.name = r.name and r1.version_number = 1 order by r1.created_at limit 1),
  r.id)
 where r.dish_id is null;
create index if not exists recipes_dish_id_idx on public.recipes (dish_id);

create or replace function public.set_recipe_dish_id()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if NEW.dish_id is null then NEW.dish_id := NEW.id; end if;   -- a brand-new dish starts its own chain
  return NEW;
end $function$;
drop trigger if exists recipes_set_dish_id on public.recipes;
create trigger recipes_set_dish_id before insert on public.recipes
  for each row execute function public.set_recipe_dish_id();

-- 2. The variants. Server-side writes only (functions below); owners and supa admins can read their own business's.
create table if not exists public.recipe_variants (
  id             uuid        primary key default gen_random_uuid(),
  business_id    text        not null references public.businesses(id) on delete cascade,
  dish_id        uuid        not null,
  label          text        not null check (char_length(btrim(label)) between 1 and 40),
  yield_portions numeric     not null check (yield_portions > 0),
  items          jsonb       not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists recipe_variants_dish_label_uidx on public.recipe_variants (dish_id, lower(btrim(label)));
create index if not exists recipe_variants_dish_idx on public.recipe_variants (dish_id);

alter table public.recipe_variants enable row level security;
drop policy if exists recipe_variants_select on public.recipe_variants;
create policy recipe_variants_select on public.recipe_variants
  for select to authenticated
  using (
    business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id')))
  );
revoke all on public.recipe_variants from anon, authenticated;
grant select on public.recipe_variants to authenticated;
grant all on public.recipe_variants to service_role;

-- 3. Create or change a variant. p_items: [{ingredient_id, quantity, unit, min_quantity?, never_cut?}]
create or replace function public.save_recipe_variant(
  p_dish_id uuid, p_variant_id uuid, p_label text, p_yield_portions numeric, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
  x jsonb;
  n int;
BEGIN
  IF v_biz IS NULL OR v_role NOT IN ('owner','supa_admin') THEN RAISE EXCEPTION 'Only an owner can save recipe variants.'; END IF;
  IF NOT (select public.business_has_access(v_biz)) THEN RAISE EXCEPTION 'Your plan has ended.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM recipes WHERE dish_id = p_dish_id AND business_id = v_biz) THEN RAISE EXCEPTION 'Dish not found.'; END IF;
  IF char_length(v_label) < 1 OR char_length(v_label) > 40 THEN RAISE EXCEPTION 'Give the variant a name of 1 to 40 characters.'; END IF;
  IF p_yield_portions IS NULL OR p_yield_portions <= 0 THEN RAISE EXCEPTION 'Plates it makes must be more than 0.'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN RAISE EXCEPTION 'Add at least one ingredient.'; END IF;
  IF jsonb_array_length(p_items) > 30 THEN RAISE EXCEPTION 'A variant can have up to 30 ingredients.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF coalesce((x->>'quantity')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every ingredient needs a quantity above 0.'; END IF;
    IF btrim(coalesce(x->>'unit', '')) = '' THEN RAISE EXCEPTION 'Every ingredient needs a unit.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ingredients WHERE id = (x->>'ingredient_id')::uuid AND business_id = v_biz) THEN RAISE EXCEPTION 'An ingredient in this variant was not found.'; END IF;
    IF nullif(x->>'min_quantity', '') IS NOT NULL AND (x->>'min_quantity')::numeric < 0 THEN RAISE EXCEPTION 'A minimum cannot be negative.'; END IF;
  END LOOP;

  IF p_variant_id IS NULL THEN
    SELECT count(*) INTO n FROM recipe_variants WHERE dish_id = p_dish_id;
    IF n >= 5 THEN RAISE EXCEPTION 'A dish can have up to 5 variants. Delete one first.'; END IF;
    BEGIN
      INSERT INTO recipe_variants (business_id, dish_id, label, yield_portions, items, created_by)
      VALUES (v_biz, p_dish_id, v_label, p_yield_portions, p_items, auth.uid()) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'This dish already has a variant called "%".', v_label;
    END;
  ELSE
    BEGIN
      UPDATE recipe_variants SET label = v_label, yield_portions = p_yield_portions, items = p_items, updated_at = now()
       WHERE id = p_variant_id AND business_id = v_biz AND dish_id = p_dish_id RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'This dish already has a variant called "%".', v_label;
    END;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Variant not found.'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $function$;
revoke all on function public.save_recipe_variant(uuid, uuid, text, numeric, jsonb) from public, anon;
grant execute on function public.save_recipe_variant(uuid, uuid, text, numeric, jsonb) to authenticated, service_role;

create or replace function public.delete_recipe_variant(p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
BEGIN
  IF v_biz IS NULL OR v_role NOT IN ('owner','supa_admin') THEN RAISE EXCEPTION 'Only an owner can delete recipe variants.'; END IF;
  DELETE FROM recipe_variants WHERE id = p_variant_id AND business_id = v_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found.'; END IF;
END $function$;
revoke all on function public.delete_recipe_variant(uuid) from public, anon;
grant execute on function public.delete_recipe_variant(uuid) to authenticated, service_role;

-- 4. Tidy up: when the last current version of a dish is deleted, its variants go too.
create or replace function public.cleanup_recipe_variants()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if OLD.dish_id is not null and not exists (select 1 from recipes where dish_id = OLD.dish_id and is_current) then
    delete from recipe_variants where dish_id = OLD.dish_id;
  end if;
  return OLD;
end $function$;
drop trigger if exists recipes_cleanup_variants on public.recipes;
create trigger recipes_cleanup_variants after delete on public.recipes
  for each row execute function public.cleanup_recipe_variants();

-- 5. save_recipe_version: same arguments and rules as before, and the new version keeps the dish_id.
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
