-- NairaPlate catering orders: event time, owner alerts for orders due soon, and a log that stops reminder emails being sent twice.
-- PART 1 any time. PART 2 (the schedule) only after the code is live. Safe to re-run. Rollback: 20261013_catering_reminders_rollback.sql

-- 1. The time of the event. Old bookings keep an empty time; the screen requires it for new ones.
alter table public.catering_deposits add column if not exists event_time time;

-- 2. One reminder email per business, kind and day. Server only.
create table if not exists public.catering_reminder_log (
  business_id   text        not null references public.businesses(id) on delete cascade,
  kind          text        not null check (kind in ('morning','evening')),
  reminder_date date        not null,
  recipients    integer     not null default 0,
  sent          integer     not null default 0,
  created_at    timestamptz not null default now(),
  primary key (business_id, kind, reminder_date)
);
alter table public.catering_reminder_log enable row level security;
revoke all on public.catering_reminder_log from anon, authenticated;
grant all on public.catering_reminder_log to service_role;

-- 3. Owner alerts, raised once a day (Nigeria time). Only the owner sees them: they are addressed to role 'owner'.
--    catering_due     an order is today or tomorrow
--    catering_balance an order within 3 days still has money to collect
-- One 'due' alert for today and one for tomorrow per order, and one 'balance' alert per order. An alert the owner has marked as seen is not raised again.
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

-- ============================== PART 2: schedule ==============================
-- Run these after the code is live. Times are UTC: 05:30 = 6:30 am Nigeria time, 17:30 = 6:30 pm.
-- Same two Vault secrets as the daily summary.
--
-- select cron.schedule('nairaplate-catering-alerts', '30 5 * * *', $$ select public.raise_catering_alerts(); $$);
--
-- select cron.schedule('nairaplate-catering-morning', '30 5 * * *', $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url') || '/api/public/catering-reminders',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')),
--     body := '{"kind":"morning"}'::jsonb, timeout_milliseconds := 60000);
-- $$);
--
-- select cron.schedule('nairaplate-catering-evening', '30 17 * * *', $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_site_url') || '/api/public/catering-reminders',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'nairaplate_daily_summary_secret')),
--     body := '{"kind":"evening"}'::jsonb, timeout_milliseconds := 60000);
-- $$);
