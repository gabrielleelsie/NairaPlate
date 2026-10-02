-- Rollback for step 4b: removes the guard and the two helper functions. No data is touched. Safe to re-run.
drop trigger if exists ingredients_protect on public.ingredients;
drop trigger if exists ingredients_protect_delete on public.ingredients;
drop function if exists public.ingredients_protect();
drop function if exists public.ingredient_ids_with_history();
drop function if exists public.ingredient_has_history(uuid);
