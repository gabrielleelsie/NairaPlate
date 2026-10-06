-- NairaPlate hygiene after 20261101_late_entries_a.sql and 20261031_dish_prices_a.sql. Safe to re-run. Rollback: 20261102_hygiene_after_late_entries_rollback.sql
-- The health check run on 4 October 2026 found three of its first eight values wrong after the paper-entry script was applied:
--   visitor_table_privileges 21 (expect 0), risky_signed_in_privileges 9 (expect 0), trigger_functions_visitors_can_run 2 (expect 0).
-- Cause: the new tables were created with the database's default grants (visitors and signed-in people get every privilege), and the guard
-- function was left executable by everyone. Row security still blocks every write, so the app was never exposed, but the sweep rule is
-- "visitors hold nothing, signed-in people hold only what they use". This script puts that back. Nothing the app does today changes.
begin;
revoke all on public.late_entries, public.late_entry_items from anon, authenticated;
grant select on public.late_entries, public.late_entry_items to authenticated;
revoke all on public.dish_price_periods from anon;
revoke all on function public.late_entries_protect() from public, anon, authenticated;
commit;
-- OPTIONAL, separate decision: 20261031 installed the btree_gist extension into the public schema but nothing uses it (no gist index, nothing
-- depends on it). It adds 188 functions to the public schema. To remove it, run this one line on its own:
--   drop extension if exists btree_gist;
