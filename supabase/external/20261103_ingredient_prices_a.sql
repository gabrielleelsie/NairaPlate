-- NairaPlate: effective-dated ingredient price history (append-only).
-- Run once in the Supabase SQL editor of the LIVE NairaPlate project. Safe to re-run.
-- Check afterwards:  20261103_ingredient_prices_a_check.sql
-- Rehearsal:         20261103_ingredient_prices_a_rehearsal.sql (nothing is saved)
-- Rollback:          20261103_ingredient_prices_a_rollback.sql
--
-- What it does
--  1. Stops at once (changing nothing) if any column or function it relies on is missing.
--  2. New table ingredient_price_history: one row per price fact, never edited or deleted.
--     Each ingredient has four price tracks: 'current' (the price plates are costed at when no grade is chosen)
--     and 'A', 'B', 'C' (the last price for that grade). Season is recorded as a detail, not a key.
--  3. Who can see it: nobody reads the table directly from the app. Owners, Supa Admins and purchasers read it only
--     through two checked functions, for their own business, while the plan is active. Nobody can write to it directly.
--  4. Who writes it: the database itself, inside the same transaction as the change:
--       - a purchase or a purchase reversal (a rule on the purchases table, so log_purchase/reverse_purchase are not edited)
--       - a manual price change (set_ingredient_price, re-created below identical to today plus the history row and an audit entry)
--     A final safety rule refuses any app price change that did not leave a history row.
--  5. Ingredients with price history can no longer be deleted, and their unit can no longer be changed.
--  6. One-off labelled backfill from purchases already recorded, and a baseline for prices known only today.
--     Older purchases recorded before quantities were stored in base units cannot be priced and are skipped (shown by the check).
--  7. If NairaPlate does not know a price at a moment in time, the lookup says so. It never substitutes another price.

begin;

-- 1. Pre-flight --------------------------------------------------------------------------------------------------------
do $pre$
declare v_missing text;
begin
  select string_agg(req.t || '.' || req.c, ', ') into v_missing
    from (values ('businesses','id'),
                 ('ingredients','current_cost_kobo'),('ingredients','previous_cost_kobo'),('ingredients','current_grade'),
                 ('ingredients','current_season'),('ingredients','price_updated_at'),('ingredients','business_id'),
                 ('ingredient_grade_prices','season'),('ingredient_grade_prices','updated_at'),('ingredient_grade_prices','cost_kobo'),
                 ('purchases','kind'),('purchases','reverses_id'),('purchases','base_qty'),('purchases','price_set_at'),
                 ('purchases','before_state'),('purchases','grade'),('purchases','season'),('purchases','recorded_by'),
                 ('purchases','recorded_at'),('purchases','total_kobo'),
                 ('audit_logs','actor_id'),('audit_logs','actor_role'),('audit_logs','action'),('audit_logs','entity_type'),
                 ('audit_logs','entity_id'),('audit_logs','details'),
                 ('staff_users','display_name'),('stock_movements','ingredient_id'),('stock_count_lines','ingredient_id')) as req(t, c)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public' and ic.table_name = req.t and ic.column_name = req.c);
  if v_missing is not null then raise exception 'Stopped, nothing changed: expected columns are missing: %', v_missing; end if;
  if to_regprocedure('public.set_ingredient_price(uuid,bigint,text,text)') is null
     or to_regprocedure('public.reverse_purchase(uuid,text)') is null
     or to_regprocedure('public.log_purchase(uuid,numeric,text,bigint,text,text,text,text,uuid)') is null
     or to_regprocedure('public.business_has_access(text)') is null
     or to_regprocedure('public.ingredients_protect()') is null then
    raise exception 'Stopped, nothing changed: one of set_ingredient_price, log_purchase, reverse_purchase, business_has_access or ingredients_protect is missing.';
  end if;
end $pre$;

-- 2. The table ---------------------------------------------------------------------------------------------------------
create table if not exists public.ingredient_price_history (
  id                      uuid primary key default gen_random_uuid(),
  seq                     bigint generated always as identity,            -- recording order; breaks same-time ties
  business_id             text not null references public.businesses(id) on delete restrict,
  ingredient_id           uuid not null references public.ingredients(id) on delete restrict,
  price_track             text not null check (price_track in ('current','A','B','C')),
  grade                   text check (grade in ('A','B','C')),
  season                  text check (season in ('plenty','normal','scarce')),
  cost_per_base_unit_kobo bigint not null check (cost_per_base_unit_kobo >= 0), -- 0 = no price from this moment
  effective_from          timestamptz not null,
  source_type             text not null check (source_type in
                            ('purchase','purchase_reversal','price_change','backfill_purchase','backfill_reversal','migration_baseline')),
  source_id               uuid not null,                                   -- purchase id, reversal id, price-change event id, or ingredient id for a baseline
  source_reference        text not null,
  actor_user_id           uuid,
  actor_role              text,
  recorded_by_kind        text not null check (recorded_by_kind in ('staff','migration')),
  is_backfilled           boolean not null default false,
  backfill_basis          text,
  created_at              timestamptz not null default now(),
  constraint iph_track_matches_grade check (price_track = 'current' or grade = price_track),
  constraint iph_backfill_labelled check (
    is_backfilled = (source_type in ('backfill_purchase','backfill_reversal','migration_baseline'))
    and (is_backfilled = (backfill_basis is not null))
    and (recorded_by_kind = case when is_backfilled then 'migration' else 'staff' end)),
  constraint iph_one_row_per_source unique (source_type, source_id, price_track)
);
create index if not exists iph_lookup_idx on public.ingredient_price_history
  (business_id, ingredient_id, price_track, effective_from desc, seq desc);
create index if not exists iph_ingredient_time_idx on public.ingredient_price_history (business_id, ingredient_id, effective_from desc);
create index if not exists iph_source_idx on public.ingredient_price_history (source_type, source_id);

revoke all on public.ingredient_price_history from public, anon, authenticated;
grant all on public.ingredient_price_history to service_role;
alter table public.ingredient_price_history enable row level security;
-- No policies on purpose: the app never reads or writes this table directly. The functions below do.

-- 3. Append-only: no edits, no deletes, no truncate - for anyone.
create or replace function public.ingredient_price_history_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  raise exception 'Ingredient price history is permanent and cannot be changed or deleted.';
end $function$;
revoke all on function public.ingredient_price_history_protect() from public, anon, authenticated;
drop trigger if exists ingredient_price_history_protect on public.ingredient_price_history;
create trigger ingredient_price_history_protect before update or delete on public.ingredient_price_history
  for each row execute function public.ingredient_price_history_protect();
drop trigger if exists ingredient_price_history_no_truncate on public.ingredient_price_history;
create trigger ingredient_price_history_no_truncate before truncate on public.ingredient_price_history
  for each statement execute function public.ingredient_price_history_protect();

-- 4. Writer for purchases and reversals (runs inside log_purchase / reverse_purchase, after the price is already set) --
create or replace function public.purchases_record_price_history()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  i   public.ingredients%rowtype;
  v_g bigint; v_gs text; v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
begin
  if NEW.kind = 'purchase' and NEW.price_set_at is null then return NEW; end if;  -- not a price-setting purchase
  select * into i from public.ingredients where id = NEW.ingredient_id;
  if not found then return NEW; end if;
  if NEW.kind = 'purchase' and i.price_updated_at is distinct from NEW.price_set_at then
    raise exception 'Price history: the purchase and the ingredient price are out of step. Nothing was saved.';
  end if;

  insert into public.ingredient_price_history
    (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
     source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind)
  values
    (NEW.business_id, i.id, 'current', i.current_grade, i.current_season, i.current_cost_kobo,
     case when NEW.kind = 'purchase' then NEW.price_set_at else NEW.recorded_at end,
     case when NEW.kind = 'purchase' then 'purchase' else 'purchase_reversal' end, NEW.id,
     case when NEW.kind = 'purchase' then 'purchase ' || NEW.id else 'reversal ' || NEW.id || ' of purchase ' || NEW.reverses_id end,
     NEW.recorded_by, v_role, 'staff');

  if NEW.grade is not null then
    select cost_kobo, season into v_g, v_gs from public.ingredient_grade_prices where ingredient_id = i.id and grade = NEW.grade;
    insert into public.ingredient_price_history
      (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
       source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind)
    values
      (NEW.business_id, i.id, NEW.grade, NEW.grade, v_gs, coalesce(v_g, 0),     -- 0 = the reversal removed this grade's only price
       case when NEW.kind = 'purchase' then NEW.price_set_at else NEW.recorded_at end,
       case when NEW.kind = 'purchase' then 'purchase' else 'purchase_reversal' end, NEW.id,
       case when NEW.kind = 'purchase' then 'purchase ' || NEW.id else 'reversal ' || NEW.id || ' of purchase ' || NEW.reverses_id end,
       NEW.recorded_by, v_role, 'staff');
  end if;
  return NEW;
end $function$;
revoke all on function public.purchases_record_price_history() from public, anon, authenticated;
drop trigger if exists purchases_record_price_history on public.purchases;
create trigger purchases_record_price_history after insert on public.purchases
  for each row execute function public.purchases_record_price_history();

-- 5. Manual price change: identical to 20261011_set_ingredient_price.sql, plus the history rows and an audit entry. ----
create or replace function public.set_ingredient_price(p_ingredient_id uuid, p_price_kobo bigint, p_grade text, p_season text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_ing  public.ingredients%rowtype;
  v_evt  uuid := gen_random_uuid();
  v_name text;
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then
    raise exception 'Only purchasers and owners can change a price.';
  end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if p_grade is null or p_grade not in ('A','B','C') then raise exception 'Choose a grade: A, B or C.'; end if;
  if p_season is null or p_season not in ('plenty','normal','scarce') then raise exception 'Choose a season: Plenty, Normal or Scarce.'; end if;
  if p_price_kobo is null or p_price_kobo <= 0 then raise exception 'Price must be more than 0.'; end if;

  select * into v_ing from public.ingredients where id = p_ingredient_id and business_id = v_biz for update;
  if not found then raise exception 'Ingredient not found.'; end if;

  update public.ingredients
     set previous_cost_kobo = case when current_cost_kobo is distinct from p_price_kobo then current_cost_kobo else previous_cost_kobo end,
         current_cost_kobo  = p_price_kobo,
         current_grade      = p_grade,
         current_season     = p_season,
         price_updated_at   = now()
   where id = v_ing.id;

  insert into public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
  values (v_ing.id, v_biz, p_grade, p_price_kobo, p_season, now())
  on conflict (ingredient_id, grade) do update set cost_kobo = excluded.cost_kobo, season = excluded.season, updated_at = now();

  insert into public.ingredient_price_history
    (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
     source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind)
  values
    (v_biz, v_ing.id, 'current', p_grade, p_season, p_price_kobo, now(), 'price_change', v_evt, 'price change ' || v_evt, auth.uid(), v_role, 'staff'),
    (v_biz, v_ing.id, p_grade,   p_grade, p_season, p_price_kobo, now(), 'price_change', v_evt, 'price change ' || v_evt, auth.uid(), v_role, 'staff');

  select display_name into v_name from public.staff_users where id = auth.uid();
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'ingredient_price_changed', 'ingredient_price_history', v_evt,
          format('%s changed the price of %s from %s to %s kobo per %s (grade %s, %s season)',
                 coalesce(v_name, 'Staff'), v_ing.name, v_ing.current_cost_kobo, p_price_kobo, v_ing.base_unit, p_grade, p_season));

  return jsonb_build_object('ingredient_id', v_ing.id, 'previous_cost_kobo', v_ing.current_cost_kobo, 'current_cost_kobo', p_price_kobo, 'grade', p_grade, 'season', p_season, 'price_event_id', v_evt);
end $function$;
revoke all on function public.set_ingredient_price(uuid, bigint, text, text) from public, anon;
grant execute on function public.set_ingredient_price(uuid, bigint, text, text) to authenticated, service_role;

-- 6. Safety rule: an app price change that leaves no history row is refused at commit. -------------------------------
--    Applies to requests from the app (database login "authenticator"). The SQL editor is left free for admin repair work.
create or replace function public.ingredients_require_price_history()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if session_user <> 'authenticator' then return null; end if;
  if NEW.current_cost_kobo is distinct from OLD.current_cost_kobo or NEW.current_grade is distinct from OLD.current_grade
     or NEW.price_updated_at is distinct from OLD.price_updated_at then
    if not exists (select 1 from public.ingredient_price_history h
                    where h.ingredient_id = NEW.id and h.price_track = 'current' and h.created_at = now()) then
      raise exception 'Price changes must be recorded in the price history. Nothing was saved.';
    end if;
  end if;
  return null;
end $function$;
revoke all on function public.ingredients_require_price_history() from public, anon, authenticated;
drop trigger if exists ingredients_require_price_history on public.ingredients;
create constraint trigger ingredients_require_price_history after update on public.ingredients
  deferrable initially deferred for each row execute function public.ingredients_require_price_history();

-- 7. Ingredients with price history keep their unit and cannot be deleted (same functions as 20261023, one more check).
create or replace function public.ingredient_has_history(p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select (auth.uid() is null or exists (select 1 from public.ingredients i where i.id = p_id and i.business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')))
     and (exists (select 1 from public.stock_movements where ingredient_id = p_id)
       or exists (select 1 from public.purchases where ingredient_id = p_id)
       or exists (select 1 from public.stock_count_lines where ingredient_id = p_id)
       or exists (select 1 from public.ingredient_price_history where ingredient_id = p_id))
$function$;
revoke all on function public.ingredient_has_history(uuid) from public, anon;
grant execute on function public.ingredient_has_history(uuid) to authenticated, service_role;

create or replace function public.ingredient_ids_with_history()
returns setof uuid language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then return; end if;
  return query
    select i.id from public.ingredients i
     where i.business_id = v_biz
       and (exists (select 1 from public.stock_movements m where m.ingredient_id = i.id)
         or exists (select 1 from public.purchases p where p.ingredient_id = i.id)
         or exists (select 1 from public.stock_count_lines c where c.ingredient_id = i.id)
         or exists (select 1 from public.ingredient_price_history h where h.ingredient_id = i.id));
end $function$;
revoke all on function public.ingredient_ids_with_history() from public, anon;
grant execute on function public.ingredient_ids_with_history() to authenticated, service_role;

-- 8. Readers (owner, Supa Admin, purchaser; own business; active plan) ------------------------------------------------
-- 8a. Rows for one ingredient (Price History screen) or all ingredients (profit report), up to a moment.
create or replace function public.ingredient_price_history_for(p_ingredient uuid default null, p_until timestamptz default null)
returns table (id uuid, seq bigint, ingredient_id uuid, price_track text, grade text, season text, cost_per_base_unit_kobo bigint,
               effective_from timestamptz, source_type text, source_reference text, actor_user_id uuid, actor_role text,
               is_backfilled boolean, backfill_basis text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then
    raise exception 'Only owners and purchasers can see ingredient price history.';
  end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  return query
    select h.id, h.seq, h.ingredient_id, h.price_track, h.grade, h.season, h.cost_per_base_unit_kobo, h.effective_from,
           h.source_type, h.source_reference, h.actor_user_id, h.actor_role, h.is_backfilled, h.backfill_basis, h.created_at
      from public.ingredient_price_history h
     where h.business_id = v_biz
       and (p_ingredient is null or h.ingredient_id = p_ingredient)
       and (p_until is null or h.effective_from <= p_until)
     order by h.ingredient_id, h.price_track, h.effective_from, h.seq;
end $function$;
revoke all on function public.ingredient_price_history_for(uuid, timestamptz) from public, anon;
grant execute on function public.ingredient_price_history_for(uuid, timestamptz) to authenticated, service_role;

-- 8b. The price in force at one moment. p_grade null = the 'current' track. Exact track only - no substitution.
--     cost_basis_status: historical_exact | historical_backfilled | no_price_at_time | unavailable_before_history
create or replace function public.ingredient_price_at(p_ingredient uuid, p_grade text, p_at timestamptz)
returns table (cost_per_base_unit_kobo bigint, price_track text, grade text, season text, effective_from timestamptz,
               source_type text, is_backfilled boolean, cost_basis_status text, earliest_known_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_biz   text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role  text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_track text := coalesce(p_grade, 'current');
  v_first timestamptz;
  h public.ingredient_price_history%rowtype;
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then
    raise exception 'Only owners and purchasers can see ingredient price history.';
  end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if v_track not in ('current','A','B','C') then raise exception 'Grade must be A, B, C or empty.'; end if;
  if p_at is null then raise exception 'Give a date and time.'; end if;

  select min(x.effective_from) into v_first from public.ingredient_price_history x
   where x.business_id = v_biz and x.ingredient_id = p_ingredient and x.price_track = v_track;

  select * into h from public.ingredient_price_history x
   where x.business_id = v_biz and x.ingredient_id = p_ingredient and x.price_track = v_track and x.effective_from <= p_at
   order by x.effective_from desc, x.seq desc
   limit 1;

  if not found then
    return query select null::bigint, v_track, null::text, null::text, null::timestamptz, null::text, null::boolean,
                        'unavailable_before_history'::text, v_first;
  elsif h.cost_per_base_unit_kobo = 0 then
    return query select null::bigint, v_track, h.grade, h.season, h.effective_from, h.source_type, h.is_backfilled,
                        'no_price_at_time'::text, v_first;
  else
    return query select h.cost_per_base_unit_kobo, v_track, h.grade, h.season, h.effective_from, h.source_type, h.is_backfilled,
                        case when h.is_backfilled then 'historical_backfilled' else 'historical_exact' end, v_first;
  end if;
end $function$;
revoke all on function public.ingredient_price_at(uuid, text, timestamptz) from public, anon;
grant execute on function public.ingredient_price_at(uuid, text, timestamptz) to authenticated, service_role;

-- 9. One-off backfill (labelled, idempotent: re-running adds nothing) ------------------------------------------------
-- 9a. Purchases that stored base quantities: same cost formula as log_purchase, round(total / base quantity).
insert into public.ingredient_price_history
  (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
   source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind, is_backfilled, backfill_basis)
select p.business_id, p.ingredient_id, t.track, p.grade, p.season, round(p.total_kobo / p.base_qty)::bigint,
       coalesce(p.price_set_at, p.recorded_at), 'backfill_purchase', p.id, 'purchase ' || p.id,
       p.recorded_by, null, 'migration', true, 'historical_purchase'
  from public.purchases p
  cross join lateral (values ('current'), (p.grade)) as t(track)
 where p.kind = 'purchase' and p.base_qty > 0 and p.total_kobo > 0 and t.track is not null
   and round(p.total_kobo / p.base_qty) > 0
on conflict (source_type, source_id, price_track) do nothing;

-- 9b. Reversals: the price went back to what it was before the purchase (stored on the purchase).
insert into public.ingredient_price_history
  (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
   source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind, is_backfilled, backfill_basis)
select r.business_id, r.ingredient_id, 'current', o.before_state ->> 'grade', o.before_state ->> 'season',
       coalesce((o.before_state ->> 'cost_kobo')::bigint, 0), r.recorded_at, 'backfill_reversal', r.id,
       'reversal ' || r.id || ' of purchase ' || o.id, r.recorded_by, null, 'migration', true, 'historical_reversal'
  from public.purchases r join public.purchases o on o.id = r.reverses_id
 where r.kind = 'reversal' and o.before_state is not null
on conflict (source_type, source_id, price_track) do nothing;

insert into public.ingredient_price_history
  (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
   source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind, is_backfilled, backfill_basis)
select r.business_id, r.ingredient_id, o.grade, o.grade,
       case when jsonb_typeof(o.before_state -> 'grade_row') = 'object' then o.before_state -> 'grade_row' ->> 'season' end,
       case when jsonb_typeof(o.before_state -> 'grade_row') = 'object' then (o.before_state -> 'grade_row' ->> 'cost_kobo')::bigint else 0 end,
       r.recorded_at, 'backfill_reversal', r.id, 'reversal ' || r.id || ' of purchase ' || o.id, r.recorded_by, null, 'migration', true, 'historical_reversal'
  from public.purchases r join public.purchases o on o.id = r.reverses_id
 where r.kind = 'reversal' and o.before_state is not null and o.grade is not null
on conflict (source_type, source_id, price_track) do nothing;

-- 9c. Baseline for today's 'current' price when history does not already end on it.
--     Dated at the ingredient's last price change if that is later than everything known; otherwise "known from now".
insert into public.ingredient_price_history
  (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
   source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind, is_backfilled, backfill_basis)
select i.business_id, i.id, 'current', i.current_grade, i.current_season, i.current_cost_kobo,
       case when i.price_updated_at is not null and (l.effective_from is null or i.price_updated_at > l.effective_from)
            then i.price_updated_at else now() end,
       'migration_baseline', i.id, 'ingredient ' || i.id || ' state at migration', null, null, 'migration', true,
       case when i.price_updated_at is not null and (l.effective_from is null or i.price_updated_at > l.effective_from)
            then 'ingredient_last_price_change' else 'known_from_migration' end
  from public.ingredients i
  left join lateral (select h.effective_from, h.cost_per_base_unit_kobo, h.grade from public.ingredient_price_history h
                      where h.ingredient_id = i.id and h.price_track = 'current'
                      order by h.effective_from desc, h.seq desc limit 1) l on true
 where i.current_cost_kobo > 0
   and (l.effective_from is null or l.cost_per_base_unit_kobo <> i.current_cost_kobo or l.grade is distinct from i.current_grade)
on conflict (source_type, source_id, price_track) do nothing;

-- 9d. Same for each grade price.
insert into public.ingredient_price_history
  (business_id, ingredient_id, price_track, grade, season, cost_per_base_unit_kobo, effective_from,
   source_type, source_id, source_reference, actor_user_id, actor_role, recorded_by_kind, is_backfilled, backfill_basis)
select i.business_id, g.ingredient_id, g.grade, g.grade, g.season, g.cost_kobo,
       case when l.effective_from is null or g.updated_at > l.effective_from then g.updated_at else now() end,
       'migration_baseline', g.ingredient_id, 'ingredient ' || g.ingredient_id || ' grade ' || g.grade || ' state at migration',
       null, null, 'migration', true,
       case when l.effective_from is null or g.updated_at > l.effective_from then 'grade_last_price_change' else 'known_from_migration' end
  from public.ingredient_grade_prices g
  join public.ingredients i on i.id = g.ingredient_id
  left join lateral (select h.effective_from, h.cost_per_base_unit_kobo from public.ingredient_price_history h
                      where h.ingredient_id = g.ingredient_id and h.price_track = g.grade
                      order by h.effective_from desc, h.seq desc limit 1) l on true
 where g.cost_kobo > 0
   and (l.effective_from is null or l.cost_per_base_unit_kobo <> g.cost_kobo)
on conflict (source_type, source_id, price_track) do nothing;

commit;
