-- Puts back the alert function from 20261013_catering_reminders.sql first, then removes the 2a objects.
create or replace function public.raise_catering_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  b record; v_bal bigint; v_ref text; v_when text; v_days int; v_n int := 0; v_msg text;
begin
  for b in
    select c.*, (c.total_contract_kobo - c.deposit_kobo - coalesce(c.additional_payments_kobo, 0)) as balance
      from public.catering_deposits c
      join public.businesses biz on biz.id = c.business_id and biz.status = 'approved'
     where c.event_date between v_today and v_today + 3
  loop
    v_bal := b.balance;
    v_days := b.event_date - v_today;
    v_ref := ' (ref ' || left(replace(b.id::text, '-', ''), 12) || ')';
    v_when := to_char(b.event_date, 'FMDay FMDD FMMonth') || case when b.event_time is not null then ' at ' || to_char(b.event_time, 'FMHH12:MI am') else '' end;

    if v_days <= 1 then
      v_msg := 'Catering order for ' || b.customer_name || ' is ' || case when v_days = 0 then 'today' else 'tomorrow' end || ': ' || v_when || '. '
               || case when v_bal > 0 and not b.settled then '₦' || to_char(v_bal / 100.0, 'FM999,999,990.00') || ' is still unpaid.' else 'It is fully paid.' end || v_ref;
      if not exists (select 1 from public.margin_flags where business_id = b.business_id and flag_type = 'catering_due' and role = 'owner' and created_at > now() - interval '2 days' and right(message, length(v_ref)) = v_ref and message like '%' || case when v_days = 0 then 'is today' else 'is tomorrow' end || '%') then
        insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
        values (b.business_id, 'catering_due', 'warn', v_msg, 'owner', false);
        v_n := v_n + 1;
      end if;
    end if;

    if v_bal > 0 and not b.settled then
      v_msg := 'Catering order for ' || b.customer_name || ' on ' || v_when || ' is ' || case when v_days = 0 then 'today' when v_days = 1 then 'tomorrow' else 'in ' || v_days || ' days' end
               || ' and ₦' || to_char(v_bal / 100.0, 'FM999,999,990.00') || ' is still unpaid.' || v_ref;
      if not exists (select 1 from public.margin_flags where business_id = b.business_id and flag_type = 'catering_balance' and role = 'owner' and created_at > now() - interval '4 days' and right(message, length(v_ref)) = v_ref) then
        insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
        values (b.business_id, 'catering_balance', 'critical', v_msg, 'owner', false);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $function$;
revoke all on function public.raise_catering_alerts() from public, anon, authenticated;
grant execute on function public.raise_catering_alerts() to service_role;

drop function if exists public.set_catering_status(uuid, text);
drop function if exists public.create_catering_order(text, text, date, time, text, text, jsonb, bigint, bigint, bigint, text);
drop table if exists public.catering_order_items;
alter table public.catering_deposits drop constraint if exists catering_deposits_status_check;
alter table public.catering_deposits drop column if exists status, drop column if exists delivery_address, drop column if exists notes, drop column if exists delivery_fee_kobo, drop column if exists discount_kobo, drop column if exists subtotal_kobo;
drop function if exists public.catering_enabled(text);
drop table if exists public.business_features;
