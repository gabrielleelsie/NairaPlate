-- NairaPlate: changing an ingredient's price by hand now records its grade and season, like a purchase does.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261011_set_ingredient_price_rollback.sql
-- Changes the price only. It does not add stock and does not create a purchase.

create or replace function public.set_ingredient_price(p_ingredient_id uuid, p_price_kobo bigint, p_grade text, p_season text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_ing  public.ingredients%rowtype;
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then
    raise exception 'Only purchasers and owners can change a price.';
  end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_grade is null or p_grade not in ('A','B','C') then raise exception 'Choose a grade: A, B or C.'; end if;
  if p_season is null or p_season not in ('plenty','normal','scarce') then raise exception 'Choose a season: Plenty, Normal or Scarce.'; end if;
  if p_price_kobo is null or p_price_kobo <= 0 then raise exception 'Price must be more than 0.'; end if;

  select * into v_ing from public.ingredients where id = p_ingredient_id and business_id = v_biz for update;
  if not found then raise exception 'Ingredient not found.'; end if;

  update public.ingredients
     set previous_cost_kobo = case when current_cost_kobo is distinct from p_price_kobo then current_cost_kobo else previous_cost_kobo end,
         current_cost_kobo  = p_price_kobo,
         current_grade      = p_grade,
         current_season     = p_season,
         price_updated_at   = now()
   where id = v_ing.id;

  insert into public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
  values (v_ing.id, v_biz, p_grade, p_price_kobo, p_season, now())
  on conflict (ingredient_id, grade) do update set cost_kobo = excluded.cost_kobo, season = excluded.season, updated_at = now();

  return jsonb_build_object('ingredient_id', v_ing.id, 'previous_cost_kobo', v_ing.current_cost_kobo, 'current_cost_kobo', p_price_kobo, 'grade', p_grade, 'season', p_season);
end $function$;
revoke all on function public.set_ingredient_price(uuid, bigint, text, text) from public, anon;
grant execute on function public.set_ingredient_price(uuid, bigint, text, text) to authenticated, service_role;
