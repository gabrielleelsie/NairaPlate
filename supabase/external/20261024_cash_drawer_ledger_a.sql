-- NairaPlate append-only records, step 5, part A: closed cash drawers that cannot be changed, one open shift per business,
-- owner-only count adjustments, and a breakdown saved on every closed shift.
-- Run once in the Supabase SQL editor, BEFORE the new drawer screen is released. Safe to re-run. Rollback: 20261024_cash_drawer_ledger_a_rollback.sql
-- A closed shift is never edited. A mistake in its count is corrected by an owner-only adjustment entry (with a reason) shown beside the original.
-- Closing a shift still happens on the server (it works out expected cash); an owner can also close a shift someone left open.
-- Needs ledger_block_change() (20261019). Until part B, the old direct insert policy remains (updates are refused from now on).

-- 1. More about each shift.
alter table public.cash_drawers
  add column if not exists opened_by_name    text,
  add column if not exists cash_sales_kobo   bigint,
  add column if not exists catering_cash_kobo bigint,
  add column if not exists debt_cash_kobo    bigint,
  add column if not exists closed_by         uuid,
  add column if not exists closed_by_name    text,
  add column if not exists forced            boolean not null default false,
  add column if not exists close_reason      text;
alter table public.cash_drawers drop constraint if exists cash_drawers_force_reason_rule;
alter table public.cash_drawers add constraint cash_drawers_force_reason_rule check (not forced or length(btrim(coalesce(close_reason, ''))) >= 5) not valid;
-- One open shift per business at a time.
create unique index if not exists cash_drawers_one_open on public.cash_drawers (business_id) where status = 'open';

-- 2. Count adjustments: added beside a closed shift, never edited or deleted.
create table if not exists public.cash_drawer_adjustments (
  id               uuid        primary key default gen_random_uuid(),
  business_id      text        not null references public.businesses(id) on delete cascade,
  drawer_id        uuid        not null references public.cash_drawers(id) on delete cascade,
  amount_kobo      bigint      not null check (amount_kobo <> 0),
  reason           text        not null check (length(btrim(reason)) >= 5),
  recorded_by      uuid,
  recorded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists cash_drawer_adjustments_drawer_idx on public.cash_drawer_adjustments (drawer_id, created_at);
alter table public.cash_drawer_adjustments enable row level security;
drop policy if exists cash_drawer_adjustments_select on public.cash_drawer_adjustments;
create policy cash_drawer_adjustments_select on public.cash_drawer_adjustments for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','cashier'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.cash_drawer_adjustments from anon, authenticated;
grant select on public.cash_drawer_adjustments to authenticated;
grant all on public.cash_drawer_adjustments to service_role;
drop trigger if exists cash_drawer_adjustments_no_change on public.cash_drawer_adjustments;
create trigger cash_drawer_adjustments_no_change before update or delete on public.cash_drawer_adjustments
  for each row execute function public.ledger_block_change();

-- 3. The guard. A signed-in person can no longer change or delete a shift. Closing is done by the server (it has no signed-in user),
--    and opening by open_cash_drawer (which sets a flag). Part B also refuses direct inserts.
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
end $function$;
drop trigger if exists cash_drawers_protect on public.cash_drawers;
create trigger cash_drawers_protect before insert or update or delete on public.cash_drawers
  for each row execute function public.cash_drawers_protect();

-- 4. Opening a shift: one open shift per business.
create or replace function public.open_cash_drawer(p_float_kobo bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; v_id uuid; o record;
begin
  if v_biz is null or v_role not in ('cashier','owner','supa_admin') then raise exception 'Only cashiers and owners can open a shift.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_float_kobo is null or p_float_kobo < 0 or p_float_kobo > 10000000000000 then raise exception 'Enter the opening float in naira.'; end if;
  select coalesce(opened_by_name, 'someone') as who, opened_at into o from public.cash_drawers where business_id = v_biz and status = 'open' limit 1;
  if found then
    raise exception 'A shift is already open (opened by % on %). It must be closed before another opens.', o.who, to_char(o.opened_at at time zone 'Africa/Lagos', 'DD Mon, HH12:MI am');
  end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  perform set_config('app.drawer_internal', '1', true);
  begin
    insert into public.cash_drawers (business_id, opened_by, opened_by_name, opening_float_kobo, status)
    values (v_biz, auth.uid(), coalesce(v_name, 'Staff'), p_float_kobo, 'open') returning id into v_id;
  exception when unique_violation then
    raise exception 'A shift is already open. It must be closed before another opens.';
  end;
  perform set_config('app.drawer_internal', '', true);
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'drawer_opened', 'cash_drawers', v_id, format('%s opened a shift with a float of %s kobo', coalesce(v_name, 'Staff'), p_float_kobo));
  return jsonb_build_object('id', v_id);
end $function$;
revoke all on function public.open_cash_drawer(bigint) from public, anon;
grant execute on function public.open_cash_drawer(bigint) to authenticated, service_role;

-- 5. A count adjustment on a closed shift: owner only, a reason of 5 or more characters. The original count is never changed.
create or replace function public.adjust_closed_drawer(p_drawer_id uuid, p_amount_kobo bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; d public.cash_drawers%rowtype; v_sum bigint; v_id uuid; v_counted bigint;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can adjust a closed shift.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  if p_amount_kobo is null or p_amount_kobo = 0 then raise exception 'The adjustment cannot be zero.'; end if;
  select * into d from public.cash_drawers where id = p_drawer_id and business_id = v_biz for update;
  if not found then raise exception 'Shift not found.'; end if;
  if d.status <> 'closed' then raise exception 'Only a closed shift can be adjusted.'; end if;
  if d.closing_counted_kobo is null then raise exception 'This shift was closed without a count, so there is no count to adjust.'; end if;
  select coalesce(sum(amount_kobo), 0) into v_sum from public.cash_drawer_adjustments where drawer_id = d.id;
  v_counted := d.closing_counted_kobo + v_sum + p_amount_kobo;
  if v_counted < 0 then raise exception 'The adjusted count cannot be below ₦0.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.cash_drawer_adjustments (business_id, drawer_id, amount_kobo, reason, recorded_by, recorded_by_name)
  values (v_biz, d.id, p_amount_kobo, btrim(p_reason), auth.uid(), coalesce(v_name, 'Owner')) returning id into v_id;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'drawer_count_adjusted', 'cash_drawers', d.id,
          format('%s adjusted a closed shift count by %s kobo (counted %s, now %s): %s', coalesce(v_name, 'Owner'), p_amount_kobo, d.closing_counted_kobo, v_counted, btrim(p_reason)));
  return jsonb_build_object('adjustment_id', v_id, 'counted_after_kobo', v_counted, 'discrepancy_after_kobo', v_counted - coalesce(d.expected_cash_kobo, 0));
end $function$;
revoke all on function public.adjust_closed_drawer(uuid, bigint, text) from public, anon;
grant execute on function public.adjust_closed_drawer(uuid, bigint, text) to authenticated, service_role;
