-- NairaPlate stock control, part B: stock-take (counting), variances, and owner approval of corrections.
-- Run AFTER part A. Safe to re-run. Rollback: 20261009_stock_control_b_rollback.sql
-- A count never changes stock by itself. It records what was expected and what was counted. When an owner counts, or approves
-- someone else's count, each difference is applied as a correction in the stock record, with its reason, and the audit log.

create table if not exists public.stock_counts (
  id                 uuid        primary key default gen_random_uuid(),
  business_id        text        not null references public.businesses(id) on delete cascade,
  is_opening         boolean     not null default false,   -- the first count that sets the starting point; not treated as a loss
  status             text        not null default 'pending' check (status in ('pending','applied','rejected')),
  note               text,
  counted_by         uuid,
  counted_by_name    text,
  decided_by         uuid,
  decided_by_name    text,
  decided_at         timestamptz,
  total_variance_kobo bigint     not null default 0,
  created_at         timestamptz not null default now()
);
create index if not exists stock_counts_biz_idx on public.stock_counts (business_id, created_at desc);

create table if not exists public.stock_count_lines (
  id            uuid        primary key default gen_random_uuid(),
  count_id      uuid        not null references public.stock_counts(id) on delete cascade,
  business_id   text        not null,
  ingredient_id uuid        not null references public.ingredients(id) on delete cascade,
  expected_base numeric     not null,       -- what the app said was in stock when the count was submitted
  counted_base  numeric     not null check (counted_base >= 0),
  variance_base numeric     not null,       -- counted minus expected: negative = less than expected
  price_kobo    bigint      not null,       -- price per base unit when counted
  value_kobo    bigint      not null,       -- variance x price
  entered_qty   numeric,
  entered_unit  text,
  note          text,
  unique (count_id, ingredient_id)
);

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
drop policy if exists stock_counts_select on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser','cook'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
drop policy if exists stock_count_lines_select on public.stock_count_lines;
create policy stock_count_lines_select on public.stock_count_lines for select to authenticated
  using (business_id = ((auth.jwt() -> 'app_metadata') ->> 'business_id')
    and ((auth.jwt() -> 'app_metadata') ->> 'role') = any (array['supa_admin','owner','purchaser','cook'])
    and (select public.business_has_access(((auth.jwt() -> 'app_metadata') ->> 'business_id'))));
revoke all on public.stock_counts, public.stock_count_lines from anon, authenticated;
grant select on public.stock_counts, public.stock_count_lines to authenticated;
grant all on public.stock_counts, public.stock_count_lines to service_role;

-- Applies every difference of a count as a correction in the stock record. Internal only.
create or replace function public.apply_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c public.stock_counts%rowtype; l record;
begin
  select * into c from public.stock_counts where id = p_count_id;
  for l in select id, ingredient_id, variance_base from public.stock_count_lines where count_id = p_count_id and variance_base <> 0 loop
    perform set_config('app.stock_reason', case when c.is_opening then 'opening_count' else 'count_correction' end, true);
    perform set_config('app.stock_ref', l.id::text, true);
    update public.ingredients set stock_base_qty = stock_base_qty + l.variance_base where id = l.ingredient_id and business_id = c.business_id;
  end loop;
  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_ref', '', true);
end $function$;
revoke all on function public.apply_stock_count(uuid) from public, anon, authenticated;

-- Submit a count. p_lines: [{ingredient_id, counted_base, entered_qty?, entered_unit?, note?}]
create or replace function public.submit_stock_count(p_note text, p_opening boolean, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text;
  v_id uuid; x jsonb; ing public.ingredients%rowtype;
  v_counted numeric; v_var numeric; v_val bigint; v_total bigint := 0; v_n int := 0; v_status text;
begin
  if v_biz is null or v_role not in ('owner','supa_admin','purchaser','cook') then raise exception 'Only owners, purchasers and kitchen staff can count stock.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if coalesce(p_opening, false) and v_role not in ('owner','supa_admin') then raise exception 'Only an owner can record the opening count.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then raise exception 'Count at least one ingredient.'; end if;
  if jsonb_array_length(p_lines) > 300 then raise exception 'Count up to 300 ingredients at a time.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  v_status := case when v_role in ('owner','supa_admin') then 'applied' else 'pending' end;

  insert into public.stock_counts (business_id, is_opening, status, note, counted_by, counted_by_name, decided_by, decided_by_name, decided_at)
  values (v_biz, coalesce(p_opening, false), v_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_name,
          case when v_status = 'applied' then auth.uid() end, case when v_status = 'applied' then v_name end, case when v_status = 'applied' then now() end)
  returning id into v_id;

  for x in select * from jsonb_array_elements(p_lines) loop
    select * into ing from public.ingredients where id = (x->>'ingredient_id')::uuid and business_id = v_biz for update;
    if not found then raise exception 'An ingredient in this count was not found.'; end if;
    v_counted := (x->>'counted_base')::numeric;
    if v_counted is null or v_counted < 0 then raise exception 'Counted amount for % cannot be negative.', ing.name; end if;
    v_var := round(v_counted - ing.stock_base_qty, 4);
    if abs(v_var) >= 0.001 and btrim(coalesce(x->>'note', '')) = '' and not coalesce(p_opening, false) then
      raise exception 'Say why % is different (counted %, expected %).', ing.name, round(v_counted, 3), round(ing.stock_base_qty, 3);
    end if;
    v_val := round(v_var * ing.current_cost_kobo);
    insert into public.stock_count_lines (count_id, business_id, ingredient_id, expected_base, counted_base, variance_base, price_kobo, value_kobo, entered_qty, entered_unit, note)
    values (v_id, v_biz, ing.id, ing.stock_base_qty, v_counted, v_var, ing.current_cost_kobo, v_val,
            nullif(x->>'entered_qty', '')::numeric, nullif(btrim(coalesce(x->>'entered_unit', '')), ''), nullif(btrim(coalesce(x->>'note', '')), ''));
    v_total := v_total + v_val; v_n := v_n + 1;
  end loop;
  update public.stock_counts set total_variance_kobo = v_total where id = v_id;
  if v_status = 'applied' then perform public.apply_stock_count(v_id); end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'stock_count_submitted', 'stock_counts', v_id,
          format('%s counted %s ingredient(s)%s, difference %s kobo, %s', coalesce(v_name, 'Staff'), v_n, case when coalesce(p_opening, false) then ' (opening count)' else '' end, v_total, case when v_status = 'applied' then 'applied' else 'waiting for an owner' end));
  return jsonb_build_object('id', v_id, 'status', v_status, 'lines', v_n, 'total_variance_kobo', v_total);
end $function$;
revoke all on function public.submit_stock_count(text, boolean, jsonb) from public, anon;
grant execute on function public.submit_stock_count(text, boolean, jsonb) to authenticated, service_role;

-- An owner approves or rejects a count that someone else submitted.
create or replace function public.decide_stock_count(p_count_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; c public.stock_counts%rowtype;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can approve or reject a count.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  select * into c from public.stock_counts where id = p_count_id and business_id = v_biz for update;
  if not found then raise exception 'Count not found.'; end if;
  if c.status <> 'pending' then raise exception 'This count has already been decided.'; end if;
  select display_name into v_name from public.staff_users where id = auth.uid();
  update public.stock_counts set status = case when p_approve then 'applied' else 'rejected' end, decided_by = auth.uid(), decided_by_name = v_name, decided_at = now() where id = c.id;
  if p_approve then perform public.apply_stock_count(c.id); end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, case when p_approve then 'stock_count_approved' else 'stock_count_rejected' end, 'stock_counts', c.id,
          format('%s %s the count by %s (difference %s kobo)', coalesce(v_name, 'Owner'), case when p_approve then 'approved' else 'rejected' end, coalesce(c.counted_by_name, 'staff'), c.total_variance_kobo));
end $function$;
revoke all on function public.decide_stock_count(uuid, boolean) from public, anon;
grant execute on function public.decide_stock_count(uuid, boolean) to authenticated, service_role;
