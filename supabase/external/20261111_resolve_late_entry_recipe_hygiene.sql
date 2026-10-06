-- NairaPlate: close a tenant-isolation gap found on 6 October 2026 (Master Specification, Part 9, S5).
-- resolve_late_entry_recipe(p_biz, p_identifier) exists only on the live database. It is SECURITY DEFINER and takes the business id as a parameter,
-- and signed-in people could run it, so a signed-in person of one business could pass another business's id and learn its dish identifiers.
-- Nothing uses it (no function, trigger, policy, view or app code), so it is closed to everyone except the server (service_role).
-- Run once in the Supabase SQL editor. Safe to re-run. Check: 20261111_resolve_late_entry_recipe_hygiene_check.sql. Undo: ..._rollback.sql
revoke all on function public.resolve_late_entry_recipe(text, text) from public, anon, authenticated;
