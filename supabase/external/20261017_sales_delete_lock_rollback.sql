-- Puts the two delete policies back exactly as they were.
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists order_items_delete on public.order_items;
create policy order_items_delete on public.order_items for delete to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
