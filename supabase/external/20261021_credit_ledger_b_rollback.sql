-- Puts the two direct write policies back exactly as they were, and the debt guard back to the part A version (amount, sale and business stay protected).
drop policy if exists customer_credits_insert on public.customer_credits;
create policy customer_credits_insert on public.customer_credits for insert to authenticated
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists customer_credits_update on public.customer_credits;
create policy customer_credits_update on public.customer_credits for update to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
create or replace function public.customer_credits_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then return NEW; end if;
  if NEW.amount_kobo is distinct from OLD.amount_kobo or NEW.order_id is distinct from OLD.order_id or NEW.business_id is distinct from OLD.business_id then
    raise exception 'The amount of a debt cannot be changed. Record a payment, a write-off or a correction instead.';
  end if;
  return NEW;
end $function$;
