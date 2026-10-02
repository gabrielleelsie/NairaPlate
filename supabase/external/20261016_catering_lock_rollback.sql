-- Puts the three catering policies back, and gives the three functions their old execute rights back, exactly as before.
drop policy if exists catering_deposits_insert on public.catering_deposits;
create policy catering_deposits_insert on public.catering_deposits for insert to authenticated
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists catering_deposits_update on public.catering_deposits;
create policy catering_deposits_update on public.catering_deposits for update to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists catering_deposits_delete on public.catering_deposits;
create policy catering_deposits_delete on public.catering_deposits for delete to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
grant execute on function public.log_purchase(uuid, numeric, text, bigint, text, text, text, text, uuid) to public, anon;
grant execute on function public.save_recipe_version(uuid, text, text, numeric, bigint, jsonb, text) to public, anon;
grant execute on function public.trial_limits_apply(text) to public, anon;
