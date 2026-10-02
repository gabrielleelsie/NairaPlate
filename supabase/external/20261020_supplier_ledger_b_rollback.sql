-- Puts the two direct write policies back exactly as they were.
drop policy if exists supplier_transactions_insert on public.supplier_transactions;
create policy supplier_transactions_insert on public.supplier_transactions for insert to authenticated
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists supplier_transactions_update on public.supplier_transactions;
create policy supplier_transactions_update on public.supplier_transactions for update to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
