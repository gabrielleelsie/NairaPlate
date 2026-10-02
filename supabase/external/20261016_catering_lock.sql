-- NairaPlate: lock the old catering table and tidy anonymous execute rights.
-- Run once in the Supabase SQL editor. No code release is needed (the app only reads this table directly; it already writes through functions).
-- Safe to re-run. Rollback: 20261016_catering_lock_rollback.sql

-- 1. Catering orders can only be created, moved and paid through create_catering_order, set_catering_status and record_catering_payment,
--    which enforce the rules and write the audit rows. Nobody can insert, edit or delete rows straight from the browser.
--    A mistaken or test booking is marked cancelled (owner), not deleted. Reading is unchanged.
drop policy if exists catering_deposits_insert on public.catering_deposits;
drop policy if exists catering_deposits_update on public.catering_deposits;
drop policy if exists catering_deposits_delete on public.catering_deposits;

-- 2. Three functions that signed-out visitors could call (each already refused them in its own code). Signed-in staff and the server keep access.
revoke execute on function public.log_purchase(uuid, numeric, text, bigint, text, text, text, text, uuid) from public, anon;
revoke execute on function public.save_recipe_version(uuid, text, text, numeric, bigint, jsonb, text) from public, anon;
revoke execute on function public.trial_limits_apply(text) from public, anon;
grant execute on function public.log_purchase(uuid, numeric, text, bigint, text, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.save_recipe_version(uuid, text, text, numeric, bigint, jsonb, text) to authenticated, service_role;
grant execute on function public.trial_limits_apply(text) to authenticated, service_role;
