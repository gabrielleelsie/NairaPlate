-- NairaPlate append-only records, step 4, part B: close the old direct write path to purchases.
-- Run ONLY AFTER the new purchases screen is live. Safe to re-run. Rollback: 20261022_purchase_ledger_b_rollback.sql
-- From now on a purchase can only be written by log_purchase (new purchases) and reverse_purchase (owner reversals).
drop policy if exists purchases_insert on public.purchases;
drop policy if exists purchases_update on public.purchases;
-- Defence in depth: even if a policy is added back by mistake, a signed-in person can only add a purchase through those two functions.
create or replace function public.purchases_check()
returns trigger language plpgsql set search_path to 'public' as $function$
declare o public.purchases%rowtype;
begin
  if auth.uid() is not null and current_setting('app.purchase_internal', true) is distinct from '1' then
    raise exception 'A purchase can only be added by logging it, or reversed by an owner.';
  end if;
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
end $function$;
