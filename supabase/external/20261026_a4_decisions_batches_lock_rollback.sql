-- Rollback for A4: puts the six direct write policies back and removes the triggers. Safe to re-run.
do $rb$ begin
  drop trigger if exists price_decisions_no_direct_insert on public.price_decisions;
  drop trigger if exists price_decisions_protect on public.price_decisions;
  drop trigger if exists batches_no_direct_insert on public.batches;
  drop trigger if exists batches_no_change on public.batches;
  drop function if exists public.price_decisions_protect();

  drop policy if exists price_decisions_insert on public.price_decisions;
  create policy price_decisions_insert on public.price_decisions for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists price_decisions_update on public.price_decisions;
  create policy price_decisions_update on public.price_decisions for update to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists price_decisions_delete on public.price_decisions;
  create policy price_decisions_delete on public.price_decisions for delete to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));

  drop policy if exists batches_insert on public.batches;
  create policy batches_insert on public.batches for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cook'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists batches_update on public.batches;
  create policy batches_update on public.batches for update to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists batches_delete on public.batches;
  create policy batches_delete on public.batches for delete to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  if not exists (select 1 from pg_trigger t where t.tgfoid = 'public.block_direct_insert()'::regprocedure and not t.tgisinternal) then
    drop function if exists public.block_direct_insert();
  end if;
end $rb$;
