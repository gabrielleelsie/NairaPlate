-- NairaPlate append-only records, step 4b: lock the stock and price columns on ingredients, the unit once history exists, and deletes.
-- Run once in the Supabase SQL editor. It adds rules only (no data changes) and can be run before or after the new Ingredients screen is released.
-- Safe to re-run. Rollback: 20261023_ingredient_guard_rollback.sql (one set of statements, no data affected).
-- Who is checked: a signed-in person or visitor (the database user "authenticated" or "anon"). The functions that legitimately change stock and
-- price (sales, voids, wastage, batches, stock take, purchases, reversals, price change) are security definer and run as their owner, so they pass
-- without being edited. The SQL editor and the server key also pass, for admin work only.

-- 1. Does this ingredient have stock history, stock-take lines or purchases? (Only answers for the caller's own business.)
create or replace function public.ingredient_has_history(p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select (auth.uid() is null or exists (select 1 from public.ingredients i where i.id = p_id and i.business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')))
     and (exists (select 1 from public.stock_movements where ingredient_id = p_id)
       or exists (select 1 from public.purchases where ingredient_id = p_id)
       or exists (select 1 from public.stock_count_lines where ingredient_id = p_id))
$function$;
revoke all on function public.ingredient_has_history(uuid) from public, anon;
grant execute on function public.ingredient_has_history(uuid) to authenticated, service_role;

-- 2. For the Ingredients screen: which of my ingredients already have history (so the unit field can be locked).
create or replace function public.ingredient_ids_with_history()
returns setof uuid language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then return; end if;
  return query
    select i.id from public.ingredients i
     where i.business_id = v_biz
       and (exists (select 1 from public.stock_movements m where m.ingredient_id = i.id)
         or exists (select 1 from public.purchases p where p.ingredient_id = i.id)
         or exists (select 1 from public.stock_count_lines c where c.ingredient_id = i.id));
end $function$;
revoke all on function public.ingredient_ids_with_history() from public, anon;
grant execute on function public.ingredient_ids_with_history() to authenticated, service_role;

-- 3. The guard. Deliberately NOT security definer: it must see who is really asking.
create or replace function public.ingredients_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user not in ('authenticated','anon') then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    if public.ingredient_has_history(OLD.id) then
      raise exception 'This ingredient has stock or purchase history, so it cannot be deleted. Adjust its count to zero with a stock take, or rename it.';
    end if;
    return OLD;
  end if;
  if TG_OP = 'INSERT' then
    if NEW.current_cost_kobo <> 0 or NEW.previous_cost_kobo <> 0 or NEW.stock_base_qty <> 0
       or NEW.current_grade is not null or NEW.current_season is not null or NEW.price_updated_at is not null then
      raise exception 'Stock and prices can only be changed by logging a purchase, a stock take, wastage or a price change.';
    end if;
    return NEW;
  end if;
  if NEW.current_cost_kobo is distinct from OLD.current_cost_kobo or NEW.previous_cost_kobo is distinct from OLD.previous_cost_kobo
     or NEW.stock_base_qty is distinct from OLD.stock_base_qty or NEW.current_grade is distinct from OLD.current_grade
     or NEW.current_season is distinct from OLD.current_season or NEW.price_updated_at is distinct from OLD.price_updated_at then
    raise exception 'Stock and prices can only be changed by logging a purchase, a stock take, wastage or a price change.';
  end if;
  if NEW.base_unit is distinct from OLD.base_unit and public.ingredient_has_history(OLD.id) then
    raise exception 'This ingredient already has stock or purchase history, so its unit cannot be changed. Add a new ingredient instead.';
  end if;
  return NEW;
end $function$;
drop trigger if exists ingredients_protect on public.ingredients;
create trigger ingredients_protect before insert or update on public.ingredients
  for each row execute function public.ingredients_protect();
drop trigger if exists ingredients_protect_delete on public.ingredients;
create trigger ingredients_protect_delete before delete on public.ingredients
  for each row execute function public.ingredients_protect();
