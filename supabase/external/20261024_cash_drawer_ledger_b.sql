-- NairaPlate append-only records, step 5, part B: close the old direct write path to cash drawers.
-- Run ONLY AFTER the new drawer screen is live (it opens shifts through open_cash_drawer). Safe to re-run. Rollback: 20261024_cash_drawer_ledger_b_rollback.sql
drop policy if exists cash_drawers_insert on public.cash_drawers;
drop policy if exists cash_drawers_update on public.cash_drawers;
-- Defence in depth: even if a policy is added back by mistake, a signed-in person cannot insert a shift directly.
create or replace function public.cash_drawers_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null or current_setting('app.drawer_internal', true) = '1' then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then raise exception 'A shift record cannot be deleted.'; end if;
  if TG_OP = 'INSERT' then raise exception 'A shift can only be opened from the drawer screen.'; end if;
  raise exception 'A shift can only be closed from the drawer screen, and a closed shift cannot be changed.';
end $function$;
