-- NairaPlate trial limits.
-- A business on its free trial (plan = 'trial') may have:
--   * at most 2 current recipes,
--   * at most 12 ingredients in one recipe,
--   * at most 20 ingredients in its ingredient list.
-- Paid plans have no limit. Editing a recipe saves a new version and does not count as a new recipe.
-- Not limited: platform admins, the service key (server routes) and the Supabase SQL editor,
-- so NairaPlate support can still set a business up.
-- Businesses already over a limit keep what they have; they just cannot add more.
-- Run once in the Supabase SQL editor. Undo with 20261001_trial_limits_rollback.sql.

begin;

create or replace function public.trial_limits_apply(p_business_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims jsonb := auth.jwt();
begin
  if v_claims is null then return false; end if;                                   -- SQL editor / database owner
  if coalesce(v_claims ->> 'role', '') = 'service_role' then return false; end if;  -- server routes
  if coalesce(v_claims -> 'app_metadata' ->> 'role', '') = 'platform_admin' then return false; end if;
  return exists (select 1 from public.businesses b where b.id = p_business_id and b.plan = 'trial');
end $$;

create or replace function public.enforce_trial_recipe_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not NEW.is_current then return NEW; end if;
  if not public.trial_limits_apply(NEW.business_id) then return NEW; end if;

  -- A new version of an existing recipe (just superseded by save_recipe_version) is not a new recipe.
  if NEW.version_number > 1 and exists (
    select 1 from public.recipes r
    where r.business_id = NEW.business_id and r.version_number = NEW.version_number - 1
      and not r.is_current and r.superseded_at >= now() - interval '1 minute'
  ) then return NEW; end if;

  perform pg_advisory_xact_lock(hashtext('trial-recipes:' || NEW.business_id));
  if (select count(*) from public.recipes where business_id = NEW.business_id and is_current) >= 2 then
    raise exception 'Free trial limit: a trial includes up to 2 recipes. Choose a plan to add more.';
  end if;
  return NEW;
end $$;

drop trigger if exists recipes_trial_limit on public.recipes;
create trigger recipes_trial_limit before insert on public.recipes
  for each row execute function public.enforce_trial_recipe_limit();

create or replace function public.enforce_trial_recipe_items_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.trial_limits_apply(NEW.business_id) then return NEW; end if;
  perform pg_advisory_xact_lock(hashtext('trial-recipe-items:' || NEW.recipe_id::text));
  if (select count(*) from public.recipe_items where recipe_id = NEW.recipe_id) >= 12 then
    raise exception 'Free trial limit: a recipe can use up to 12 ingredients on a trial. Choose a plan to add more.';
  end if;
  return NEW;
end $$;

drop trigger if exists recipe_items_trial_limit on public.recipe_items;
create trigger recipe_items_trial_limit before insert on public.recipe_items
  for each row execute function public.enforce_trial_recipe_items_limit();

create or replace function public.enforce_trial_ingredient_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.trial_limits_apply(NEW.business_id) then return NEW; end if;
  perform pg_advisory_xact_lock(hashtext('trial-ingredients:' || NEW.business_id));
  if (select count(*) from public.ingredients where business_id = NEW.business_id) >= 20 then
    raise exception 'Free trial limit: a trial includes up to 20 ingredients. Choose a plan to add more.';
  end if;
  return NEW;
end $$;

drop trigger if exists ingredients_trial_limit on public.ingredients;
create trigger ingredients_trial_limit before insert on public.ingredients
  for each row execute function public.enforce_trial_ingredient_limit();

commit;
