-- NairaPlate stock alerts: tell the owner and the purchaser when an ingredient runs low or goes below zero, whatever caused it
-- (a sale, wastage, a batch, a count). Run once in the Supabase SQL editor. Safe to re-run. Rollback: 20261010_stock_alerts_rollback.sql
-- Needs the stock record from 20261009_stock_control_a.sql.
-- One alert per ingredient and kind until someone marks it as seen; it clears itself when stock is back above the level.

create or replace function public.raise_stock_alerts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  i public.ingredients%rowtype;
  v_role text;
  v_prefix text;
  v_msg text;
begin
  select * into i from public.ingredients where id = NEW.ingredient_id;
  if not found then return NEW; end if;

  if NEW.qty_base < 0 then
    -- Stock went down: below zero is the stronger alert; otherwise at or below the reorder level.
    if NEW.balance_after < 0 then
      v_prefix := i.name || ' stock is below zero:';
      v_msg := v_prefix || ' ' || round(NEW.balance_after, 2) || ' ' || i.base_unit || '. Check the stock count.';
      foreach v_role in array array['owner', 'purchaser'] loop
        if not exists (select 1 from public.margin_flags where business_id = NEW.business_id and flag_type = 'negative_stock'
                         and acknowledged = false and role = v_role and left(message, length(v_prefix)) = v_prefix) then
          insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
          values (NEW.business_id, 'negative_stock', 'critical', v_msg, v_role, false);
        end if;
      end loop;
    elsif coalesce(i.min_threshold_qty, 0) > 0 and NEW.balance_after <= i.min_threshold_qty then
      v_prefix := i.name || ' is running low:';
      v_msg := v_prefix || ' ' || round(NEW.balance_after, 2) || ' ' || i.base_unit || ' left (reorder level ' || round(i.min_threshold_qty, 2) || ' ' || i.base_unit || ').';
      foreach v_role in array array['owner', 'purchaser'] loop
        if not exists (select 1 from public.margin_flags where business_id = NEW.business_id and flag_type = 'low_stock'
                         and acknowledged = false and role = v_role and left(message, length(v_prefix)) = v_prefix) then
          insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
          values (NEW.business_id, 'low_stock', 'warn', v_msg, v_role, false);
        end if;
      end loop;
    end if;
  elsif NEW.qty_base > 0 then
    -- Stock went up (a purchase, a count correction): clear alerts that are no longer true.
    update public.margin_flags set acknowledged = true
     where business_id = NEW.business_id and acknowledged = false
       and ((flag_type = 'negative_stock' and NEW.balance_after >= 0 and left(message, length(i.name || ' stock is below zero:')) = i.name || ' stock is below zero:')
         or (flag_type = 'low_stock' and NEW.balance_after > coalesce(i.min_threshold_qty, 0) and left(message, length(i.name || ' is running low:')) = i.name || ' is running low:'));
  end if;
  return NEW;
end $function$;

drop trigger if exists stock_movements_alerts on public.stock_movements;
create trigger stock_movements_alerts after insert on public.stock_movements
  for each row when (NEW.reason <> 'opening_balance')
  execute function public.raise_stock_alerts();

-- Purchasers can read and mark as seen only the alerts addressed to the purchaser (until now they could not open any alert).
drop policy if exists margin_flags_select_purchaser on public.margin_flags;
create policy margin_flags_select_purchaser on public.margin_flags for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'purchaser'
    and role = 'purchaser'
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists margin_flags_update_purchaser on public.margin_flags;
create policy margin_flags_update_purchaser on public.margin_flags for update to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'purchaser'
    and role = 'purchaser'
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))))
  with check (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = 'purchaser'
    and role = 'purchaser');
