-- NairaPlate Step 6, A3: channel payouts can only be written by log_channel_payout, and never edited or deleted.
-- Why: owners can currently insert and edit payout rows directly, so a payout figure can be changed after the mismatch check.
-- The only real writer is log_channel_payout (runs as the database owner). The Payouts screen is unchanged.
-- A typo in a payout can no longer be fixed by editing. A correction function can be added later (decision: freeze now, correct later).
-- Needs block_direct_insert() (created here too). Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261026_a3_channel_payouts_lock_rollback.sql
create or replace function public.block_direct_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user in ('authenticated','anon') then
    raise exception '%', coalesce(TG_ARGV[0], 'This record can only be added through the app functions.');
  end if;
  return NEW;
end $function$;
revoke all on function public.block_direct_insert() from public, anon;

drop policy if exists channel_payouts_insert on public.channel_payouts;
drop policy if exists channel_payouts_update on public.channel_payouts;
drop trigger if exists channel_payouts_no_direct_insert on public.channel_payouts;
create trigger channel_payouts_no_direct_insert before insert on public.channel_payouts
  for each row execute function public.block_direct_insert('A payout can only be recorded from the Payouts screen.');
drop trigger if exists channel_payouts_no_change on public.channel_payouts;
create trigger channel_payouts_no_change before update or delete on public.channel_payouts
  for each row execute function public.ledger_block_change();
