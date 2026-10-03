-- Rollback for A3: puts the two direct write policies back and removes the triggers. Safe to re-run.
do $rb$ begin
  drop trigger if exists channel_payouts_no_direct_insert on public.channel_payouts;
  drop trigger if exists channel_payouts_no_change on public.channel_payouts;
  drop policy if exists channel_payouts_insert on public.channel_payouts;
  create policy channel_payouts_insert on public.channel_payouts for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists channel_payouts_update on public.channel_payouts;
  create policy channel_payouts_update on public.channel_payouts for update to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  if not exists (select 1 from pg_trigger t where t.tgfoid = 'public.block_direct_insert()'::regprocedure and not t.tgisinternal) then
    drop function if exists public.block_direct_insert();
  end if;
end $rb$;
