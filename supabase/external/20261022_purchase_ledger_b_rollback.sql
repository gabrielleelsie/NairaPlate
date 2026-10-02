-- Rollback for part B: puts the two direct write policies on purchases back and restores the part A version of the guard. Safe to re-run.
do $rb$ begin
  drop policy if exists purchases_insert on public.purchases;
  create policy purchases_insert on public.purchases for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists purchases_update on public.purchases;
  create policy purchases_update on public.purchases for update to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  execute $f$
  create or replace function public.purchases_check()
  returns trigger language plpgsql set search_path to 'public' as $function$
  declare o public.purchases%rowtype;
  begin
    if NEW.kind <> 'reversal' then return NEW; end if;
    if auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
      raise exception 'Only an owner can reverse a purchase.';
    end if;
    select * into o from public.purchases where id = NEW.reverses_id;
    if not found then raise exception 'The purchase being reversed was not found.'; end if;
    if o.kind <> 'purchase' then raise exception 'Only a purchase can be reversed.'; end if;
    if o.business_id <> NEW.business_id or o.ingredient_id <> NEW.ingredient_id then raise exception 'That purchase belongs to a different ingredient.'; end if;
    if NEW.qty <> -o.qty or NEW.total_kobo <> -o.total_kobo then raise exception 'A reversal must be for exactly the quantity and amount of the purchase.'; end if;
    return NEW;
  end $function$ $f$;
end $rb$;
