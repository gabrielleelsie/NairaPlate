-- NairaPlate Step 6, A1: refund and void records (order_adjustments) can only be written by adjust_order, and never edited or deleted.
-- Why: expected cash reads part refunds from this table. A forged part refund lowers expected cash and can hide a drawer shortage.
-- The only real writer is the adjust_order function. It runs as the database owner, so it passes without being edited. The Orders screen is unchanged.
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261026_a1_refund_records_lock_rollback.sql
-- Shared helper (used by A1 to A4): refuses a direct insert by a signed-in person or visitor. Deliberately NOT security definer, so it sees who is really asking.
create or replace function public.block_direct_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user in ('authenticated','anon') then
    raise exception '%', coalesce(TG_ARGV[0], 'This record can only be added through the app functions.');
  end if;
  return NEW;
end $function$;

drop policy if exists order_adjustments_insert on public.order_adjustments;
drop policy if exists order_adjustments_update on public.order_adjustments;
drop trigger if exists order_adjustments_no_direct_insert on public.order_adjustments;
create trigger order_adjustments_no_direct_insert before insert on public.order_adjustments
  for each row execute function public.block_direct_insert('A void or refund can only be recorded from the Orders screen.');
drop trigger if exists order_adjustments_no_change on public.order_adjustments;
create trigger order_adjustments_no_change before update or delete on public.order_adjustments
  for each row execute function public.ledger_block_change();
