-- NairaPlate fix: logging a batch fails ("record new has no field cost_per_plate_kobo").
-- Cause: the trigger that stamps the recipe version on batches uses the same function as the one for order lines. That function also sets
-- cost_per_plate_kobo, which only order lines have. Batches have no such column, so every batch insert fails, for every cook and owner.
-- Fix: give batches their own small function that stamps the recipe version only. Order lines are untouched.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261025_batch_trigger_fix_rollback.sql
create or replace function public.stamp_batch_version()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  select cur.id into NEW.recipe_version_id
    from public.recipes picked
    join public.recipes cur on cur.business_id = picked.business_id and cur.name = picked.name and cur.is_current
   where picked.id = NEW.recipe_id;
  if NEW.recipe_version_id is null then NEW.recipe_version_id := NEW.recipe_id; end if;
  return NEW;
end $function$;
revoke all on function public.stamp_batch_version() from public, anon, authenticated;
drop trigger if exists batches_stamp_version on public.batches;
create trigger batches_stamp_version before insert on public.batches
  for each row execute function public.stamp_batch_version();
