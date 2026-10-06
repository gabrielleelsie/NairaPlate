-- NairaPlate: close the last item the health check found (3 October sweep rule: signed-out visitors run no trigger function).
-- receipts_guard() is a trigger function on receipts (it blocks deletes and edits). It was created with the database default of
-- "anyone may run it". A trigger function cannot be called directly and holds no data, so nothing was exposed, but it breaks the rule.
-- Run once in the Supabase SQL editor. Safe to re-run. Check: 20261108_receipts_guard_hygiene_check.sql. Undo: 20261108_receipts_guard_hygiene_rollback.sql
-- The trigger keeps working: the database checks the right to run a trigger function only when the trigger is created, not when it fires.
revoke all on function public.receipts_guard() from public, anon, authenticated;
