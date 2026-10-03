-- NairaPlate Step 6, A2: the audit trail (audit_logs) can only be written by the database and the server, and never edited or deleted.
-- Why: today any signed-in staff member, even a cook, can add an audit line with any actor and description, so the trail can be padded or forged.
-- Checked first: all 22 functions that write audit lines, and every audit trigger, run as the database owner; the server routes use the server key.
-- No screen writes audit lines. Needs block_direct_insert() from A1 (created here too, safe to repeat).
-- Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261026_a2_audit_trail_lock_rollback.sql
create or replace function public.block_direct_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_user in ('authenticated','anon') then
    raise exception '%', coalesce(TG_ARGV[0], 'This record can only be added through the app functions.');
  end if;
  return NEW;
end $function$;
revoke all on function public.block_direct_insert() from public, anon;

drop policy if exists audit_logs_insert on public.audit_logs;
drop trigger if exists audit_logs_no_direct_insert on public.audit_logs;
create trigger audit_logs_no_direct_insert before insert on public.audit_logs
  for each row execute function public.block_direct_insert('Audit entries are written by the system only.');
drop trigger if exists audit_logs_no_change on public.audit_logs;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.ledger_block_change();
