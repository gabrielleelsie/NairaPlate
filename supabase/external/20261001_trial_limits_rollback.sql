-- Removes the trial limits (see 20261001_trial_limits.sql).
begin;
drop trigger if exists recipes_trial_limit on public.recipes;
drop trigger if exists recipe_items_trial_limit on public.recipe_items;
drop trigger if exists ingredients_trial_limit on public.ingredients;
drop function if exists public.enforce_trial_recipe_limit();
drop function if exists public.enforce_trial_recipe_items_limit();
drop function if exists public.enforce_trial_ingredient_limit();
drop function if exists public.trial_limits_apply(text);
commit;
