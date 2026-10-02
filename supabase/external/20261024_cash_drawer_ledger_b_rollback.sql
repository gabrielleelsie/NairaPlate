-- Rollback for part B: puts the two direct write policies on cash_drawers back and restores the part A guard. Safe to re-run.
do $rb$ begin
  drop policy if exists cash_drawers_insert on public.cash_drawers;
  create policy cash_drawers_insert on public.cash_drawers for insert to authenticated
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  drop policy if exists cash_drawers_update on public.cash_drawers;
  create policy cash_drawers_update on public.cash_drawers for update to authenticated
    using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
    with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
      and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
      and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
  execute $f$
  create or replace function public.cash_drawers_protect()
  returns trigger language plpgsql set search_path to 'public' as $function$
  begin
    if auth.uid() is null or current_setting('app.drawer_internal', true) = '1' then
      if TG_OP = 'DELETE' then return OLD; end if;
      return NEW;
    end if;
    if TG_OP = 'DELETE' then raise exception 'A shift record cannot be deleted.'; end if;
    if TG_OP = 'INSERT' then
      if NEW.status <> 'open' or NEW.closing_counted_kobo is not null or NEW.expected_cash_kobo is not null or NEW.discrepancy_kobo is not null or NEW.closed_at is not null or NEW.forced then
        raise exception 'A shift can only be started open.';
      end if;
      return NEW;
    end if;
    raise exception 'A shift can only be closed from the drawer screen, and a closed shift cannot be changed.';
  end $function$ $f$;
end $rb$;
