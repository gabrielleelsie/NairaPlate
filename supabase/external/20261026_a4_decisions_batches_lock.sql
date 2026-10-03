-- NairaPlate Step 6, A4: price decisions and batches can only be written by decide_price and log_batch, and never edited or deleted.
-- Why: owners can currently write, edit and delete both directly, so decision history and batch history can be altered.
-- Writers: decide_price and log_batch (both run as the database owner). The screens are unchanged.
-- Deleting a recipe still works: it sets price_decisions.recipe_id to empty (the decision stays), and a recipe with batches is already protected.
-- Apply AFTER the batch fix (20261025_batch_trigger_fix.sql), or batches cannot be logged at all.
-- A wrongly recorded decision or batch can no longer be removed by editing. A correction function can be added later (decision: freeze now, correct later).
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261026_a4_decisions_batches_lock_rollback.sql
create or replace function public.block_direct_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user in ('authenticated','anon') then
    raise exception '%', coalesce(TG_ARGV[0], 'This record can only be added through the app functions.');
  end if;
  return NEW;
end $function$;

-- price decisions: frozen, except that the link to a deleted recipe or user is emptied by the database itself
create or replace function public.price_decisions_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and NEW.id = OLD.id and NEW.business_id = OLD.business_id and NEW.previous_price_kobo is not distinct from OLD.previous_price_kobo
     and NEW.suggested_price_kobo is not distinct from OLD.suggested_price_kobo and NEW.decision is not distinct from OLD.decision
     and NEW.created_at is not distinct from OLD.created_at
     and (NEW.recipe_id is null or NEW.recipe_id = OLD.recipe_id) and (NEW.decided_by is null or NEW.decided_by = OLD.decided_by)
     and ((NEW.recipe_id is distinct from OLD.recipe_id) or (NEW.decided_by is distinct from OLD.decided_by)) then
    return NEW;
  end if;
  raise exception 'This record cannot be changed or deleted. Add a correction instead.';
end $function$;

drop policy if exists price_decisions_insert on public.price_decisions;
drop policy if exists price_decisions_update on public.price_decisions;
drop policy if exists price_decisions_delete on public.price_decisions;
drop trigger if exists price_decisions_no_direct_insert on public.price_decisions;
create trigger price_decisions_no_direct_insert before insert on public.price_decisions
  for each row execute function public.block_direct_insert('A price decision can only be recorded from the pricing screen.');
drop trigger if exists price_decisions_protect on public.price_decisions;
create trigger price_decisions_protect before update or delete on public.price_decisions
  for each row execute function public.price_decisions_protect();

-- batches
drop policy if exists batches_insert on public.batches;
drop policy if exists batches_update on public.batches;
drop policy if exists batches_delete on public.batches;
drop trigger if exists batches_no_direct_insert on public.batches;
create trigger batches_no_direct_insert before insert on public.batches
  for each row execute function public.block_direct_insert('A batch can only be logged from the Batches screen.');
drop trigger if exists batches_no_change on public.batches;
create trigger batches_no_change before update or delete on public.batches
  for each row execute function public.ledger_block_change();
