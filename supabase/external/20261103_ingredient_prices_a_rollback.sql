-- Rollback for 20261103_ingredient_prices_a.sql. Run in the Supabase SQL editor of the LIVE project.
-- WARNING: this permanently removes the ingredient price history table and every row in it.
-- Prices on ingredients, purchases and the audit trail are NOT touched. Safe to re-run.
begin;
drop trigger if exists purchases_record_price_history on public.purchases;
drop trigger if exists ingredients_require_price_history on public.ingredients;
drop function if exists public.purchases_record_price_history();
drop function if exists public.ingredients_require_price_history();
drop function if exists public.ingredient_price_at(uuid, text, timestamptz);
drop function if exists public.ingredient_price_history_for(uuid, timestamptz);

-- Put set_ingredient_price back exactly as in 20261011_set_ingredient_price.sql
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

-- Put the ingredient history checks back exactly as in 20261023_ingredient_guard.sql
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

drop table if exists public.ingredient_price_history;   -- also removes its two protect triggers
drop function if exists public.ingredient_price_history_protect();
commit;
