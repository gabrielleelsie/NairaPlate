-- NairaPlate Phase 1: Owner-Approved Late Entry (Part A)
-- Controlled recovery workflow for sales recorded on paper fallback during an outage.
-- Paper fallback record != sale; only owner/supa_admin approval posts an authoritative sale.
-- Prices are locked at the historical actual sale time via dish_price_at().
-- Safe to re-run.

begin;

-- 1. Metadata columns on public.orders for full auditability
alter table public.orders
  add column if not exists is_late_entry boolean not null default false,
  add column if not exists actual_sold_at timestamptz,
  add column if not exists paper_reference text,
  add column if not exists late_delay_seconds integer,
  add column if not exists late_entered_by uuid references auth.users(id),
  add column if not exists late_approved_by uuid references auth.users(id);

-- 2. Append-only late entry queue table
create table if not exists public.late_entries (
  id                  uuid        primary key default gen_random_uuid(),
  business_id         text        not null references public.businesses(id) on delete cascade,
  client_sale_id      uuid        not null,
  paper_reference     text        not null check (length(btrim(paper_reference)) >= 2),
  status              text        not null default 'submitted'
                                  check (status in ('draft','submitted','needs_shift_review','approved','rejected','posted')),
  actual_sold_at      timestamptz not null,
  entered_at          timestamptz not null default now(),
  delay_seconds       integer     not null check (delay_seconds >= 0),
  outage_reason       text        not null check (length(btrim(outage_reason)) >= 3),
  entered_by          uuid        not null references auth.users(id),
  approved_by         uuid        references auth.users(id),
  approved_at         timestamptz,
  rejected_by         uuid        references auth.users(id),
  rejected_at         timestamptz,
  rejection_reason    text        check (rejection_reason is null or length(btrim(rejection_reason)) >= 5),
  source_shift_id     uuid        references public.cash_drawers(id),
  shift_resolution    text        check (shift_resolution is null or shift_resolution in ('open_shift_direct','closed_shift_included','closed_shift_late_cash')),
  channel             text        not null default 'walk_in',
  price_tier          text        not null default 'standard',
  payment_method      text        not null check (payment_method in ('cash','transfer','split')),
  cash_kobo           bigint      not null default 0 check (cash_kobo >= 0),
  transfer_kobo       bigint      not null default 0 check (transfer_kobo >= 0),
  total_kobo          bigint      not null check (total_kobo > 0),
  posted_order_id     uuid        references public.orders(id),
  notes               text,
  created_at          timestamptz not null default now(),
  constraint late_entries_biz_client_uniq unique (business_id, client_sale_id),
  constraint late_entries_payment_sum_check check (cash_kobo + transfer_kobo = total_kobo)
);

create index if not exists late_entries_biz_status_idx on public.late_entries (business_id, status);
create index if not exists late_entries_paper_idx on public.late_entries (business_id, paper_reference);

-- 3. Frozen items per late entry, locking historical dish price
create table if not exists public.late_entry_items (
  id                  uuid        primary key default gen_random_uuid(),
  late_entry_id       uuid        not null references public.late_entries(id) on delete cascade,
  business_id         text        not null references public.businesses(id) on delete cascade,
  recipe_id           uuid        not null references public.recipes(id),
  dish_name           text        not null,
  quantity            numeric     not null check (quantity > 0),
  dish_price_id       uuid        references public.dish_prices(id),
  unit_price_kobo     bigint      not null check (unit_price_kobo > 0),
  line_total_kobo     bigint      not null check (line_total_kobo > 0),
  created_at          timestamptz not null default now()
);

create index if not exists late_entry_items_entry_idx on public.late_entry_items (late_entry_id);

-- RLS & Grants on late_entries and late_entry_items
alter table public.late_entries enable row level security;
alter table public.late_entry_items enable row level security;

drop policy if exists late_entries_select on public.late_entries;
create policy late_entries_select on public.late_entries for select to authenticated
  using (
    business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    and (auth.jwt() -> 'app_metadata' ->> 'role') in ('cashier', 'owner', 'supa_admin')
    and (select public.business_has_access(business_id))
  );

drop policy if exists late_entry_items_select on public.late_entry_items;
create policy late_entry_items_select on public.late_entry_items for select to authenticated
  using (
    business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')
    and (auth.jwt() -> 'app_metadata' ->> 'role') in ('cashier', 'owner', 'supa_admin')
    and (select public.business_has_access(business_id))
  );

grant select on public.late_entries to authenticated;
grant select on public.late_entry_items to authenticated;
grant all on public.late_entries to service_role;
grant all on public.late_entry_items to service_role;

-- 4. Immutability guard trigger: blocks direct user UPDATE / DELETE
create or replace function public.late_entries_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if current_setting('app.late_internal', true) = '1' or auth.uid() is null then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'Late entry records are append-only and cannot be deleted.';
  end if;
  if TG_OP = 'UPDATE' then
    raise exception 'Late entry records cannot be directly edited.';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists late_entries_protect on public.late_entries;
create trigger late_entries_protect before update or delete on public.late_entries
  for each row execute function public.late_entries_protect();

drop trigger if exists late_entry_items_protect on public.late_entry_items;
create trigger late_entry_items_protect before update or delete on public.late_entry_items
  for each row execute function public.late_entries_protect();

-- 5. Submitting a late entry request (Cashier, Owner, Supa Admin)
create or replace function public.submit_late_entry(
  p_client_sale_id    uuid,
  p_paper_reference   text,
  p_actual_sold_at    timestamptz,
  p_outage_reason     text,
  p_payment_method    text,
  p_cash_kobo         bigint,
  p_transfer_kobo     bigint,
  p_items             jsonb,
  p_notes             text default null,
  p_channel           text default 'walk_in',
  p_price_tier        text default 'standard'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz       text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role      text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid       uuid := auth.uid();
  v_entry_id  uuid;
  v_total     bigint := 0;
  v_delay_sec integer;
  v_shift_id  uuid;
  v_shift_stat text;
  v_init_stat text := 'submitted';
  it          jsonb;
  v_qty       numeric;
  v_dish_uuid uuid;
  v_dish_name text;
  v_price_row record;
  v_item_tot  bigint;
begin
  if v_biz is null or v_role not in ('cashier', 'owner', 'supa_admin') then
    raise exception 'Only cashiers and owners can submit late entries.';
  end if;
  if not (select public.business_has_access(v_biz)) then
    raise exception 'Your plan has ended.';
  end if;
  if p_client_sale_id is null then
    raise exception 'A unique client sale identifier is required.';
  end if;
  if length(btrim(coalesce(p_paper_reference, ''))) < 2 then
    raise exception 'A valid paper fallback reference is required (min 2 characters).';
  end if;
  if length(btrim(coalesce(p_outage_reason, ''))) < 3 then
    raise exception 'A clear outage reason is required (min 3 characters).';
  end if;
  if p_actual_sold_at is null then
    raise exception 'Actual sale date and time must be provided.';
  end if;
  if p_actual_sold_at > now() + interval '5 minutes' then
    raise exception 'Sale time cannot be in the future.';
  end if;
  if p_actual_sold_at < now() - interval '72 hours' then
    raise exception 'Sale time is older than the allowed 72-hour late entry window.';
  end if;
  if p_payment_method not in ('cash', 'transfer', 'split') then
    raise exception 'Payment method must be cash, transfer, or split.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required.';
  end if;

  -- Idempotency check on (business_id, client_sale_id)
  select id into v_entry_id from public.late_entries
   where business_id = v_biz and client_sale_id = p_client_sale_id;
  if v_entry_id is not null then
    return jsonb_build_object('late_entry_id', v_entry_id, 'already_submitted', true);
  end if;

  v_delay_sec := greatest(0, round(extract(epoch from (now() - p_actual_sold_at))))::integer;

  -- Check shift status at the time of the sale
  select id, status into v_shift_id, v_shift_stat
    from public.cash_drawers
   where business_id = v_biz
     and opened_at <= p_actual_sold_at
     and (closed_at is null or closed_at >= p_actual_sold_at)
   order by opened_at desc
   limit 1;

  if v_shift_id is null or v_shift_stat = 'closed' then
    v_init_stat := 'needs_shift_review';
  end if;

  -- Validate each line item using historical price at p_actual_sold_at
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Every item needs a quantity greater than zero.';
    end if;

    v_dish_uuid := (it->>'recipe_id')::uuid;

    select name into v_dish_name from public.recipes
     where id = v_dish_uuid and business_id = v_biz;
    if v_dish_name is null then
      raise exception 'A dish in this entry was not found on your menu.';
    end if;

    select id, price_kobo into v_price_row from public.dish_price_at(v_dish_uuid, p_actual_sold_at);
    if v_price_row.price_kobo is null or v_price_row.price_kobo <= 0 then
      raise exception 'No valid price found for % at the time of the sale (%).', v_dish_name, p_actual_sold_at;
    end if;

    v_item_tot := round(v_price_row.price_kobo * v_qty);
    v_total := v_total + v_item_tot;
  end loop;

  -- Validate payment totals
  if coalesce(p_cash_kobo, 0) < 0 or coalesce(p_transfer_kobo, 0) < 0 then
    raise exception 'Amounts cannot be negative.';
  end if;
  if coalesce(p_cash_kobo, 0) + coalesce(p_transfer_kobo, 0) <> v_total then
    raise exception 'Cash and transfer must add up exactly to the total (% kobo).', v_total;
  end if;
  if p_payment_method = 'cash' and coalesce(p_transfer_kobo, 0) <> 0 then
    raise exception 'A cash sale cannot have a transfer amount.';
  end if;
  if p_payment_method = 'transfer' and coalesce(p_cash_kobo, 0) <> 0 then
    raise exception 'A transfer sale cannot have a cash amount.';
  end if;
  if p_payment_method = 'split' and (coalesce(p_cash_kobo, 0) <= 0 or coalesce(p_transfer_kobo, 0) <= 0) then
    raise exception 'A split sale requires both a cash and a transfer amount.';
  end if;

  -- Insert header
  perform set_config('app.late_internal', '1', true);
  insert into public.late_entries (
    business_id, client_sale_id, paper_reference, status,
    actual_sold_at, delay_seconds, outage_reason, entered_by,
    source_shift_id, channel, price_tier, payment_method,
    cash_kobo, transfer_kobo, total_kobo, notes
  ) values (
    v_biz, p_client_sale_id, btrim(p_paper_reference), v_init_stat,
    p_actual_sold_at, v_delay_sec, btrim(p_outage_reason), v_uid,
    v_shift_id, coalesce(p_channel, 'walk_in'), coalesce(p_price_tier, 'standard'), p_payment_method,
    coalesce(p_cash_kobo, 0), coalesce(p_transfer_kobo, 0), v_total, p_notes
  ) returning id into v_entry_id;

  -- Insert items freezing historical price snapshot
  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'quantity')::numeric;
    v_dish_uuid := (it->>'recipe_id')::uuid;
    select name into v_dish_name from public.recipes where id = v_dish_uuid and business_id = v_biz;
    select id, price_kobo into v_price_row from public.dish_price_at(v_dish_uuid, p_actual_sold_at);
    v_item_tot := round(v_price_row.price_kobo * v_qty);

    insert into public.late_entry_items (
      late_entry_id, business_id, recipe_id, dish_name,
      quantity, dish_price_id, unit_price_kobo, line_total_kobo
    ) values (
      v_entry_id, v_biz, v_dish_uuid, v_dish_name,
      v_qty, v_price_row.id, v_price_row.price_kobo, v_item_tot
    );
  end loop;
  perform set_config('app.late_internal', '', true);

  -- Audit event
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (
    v_biz, v_uid, v_role, 'late_entry_submitted', 'late_entries', v_entry_id,
    format('Late entry submitted with paper ref "%s", amount ₦%s, delay %s min',
      p_paper_reference, to_char(v_total / 100.0, 'FM999,999,990.00'), round(v_delay_sec / 60.0))
  );

  return jsonb_build_object(
    'late_entry_id', v_entry_id,
    'status', v_init_stat,
    'total_kobo', v_total,
    'already_submitted', false
  );
end;
$function$;

revoke all on function public.submit_late_entry from public, anon;
grant execute on function public.submit_late_entry to authenticated, service_role;

-- 6. Rejecting a late entry (Owner and Supa Admin only)
create or replace function public.reject_late_entry(
  p_id      uuid,
  p_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz   text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role  text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid   uuid := auth.uid();
  e       public.late_entries%rowtype;
begin
  if v_biz is null or v_role not in ('owner', 'supa_admin') then
    raise exception 'Only business owners can reject late entries.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A rejection reason of at least 5 characters is required.';
  end if;

  select * into e from public.late_entries where id = p_id and business_id = v_biz for update;
  if not found then
    raise exception 'Late entry record not found.';
  end if;
  if e.status not in ('submitted', 'needs_shift_review') then
    raise exception 'This late entry is already % and cannot be rejected.', e.status;
  end if;

  perform set_config('app.late_internal', '1', true);
  update public.late_entries
     set status = 'rejected',
         rejected_by = v_uid,
         rejected_at = now(),
         rejection_reason = btrim(p_reason)
   where id = p_id;
  perform set_config('app.late_internal', '', true);

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (
    v_biz, v_uid, v_role, 'late_entry_rejected', 'late_entries', p_id,
    format('Late entry "%s" rejected by owner: %s', e.paper_reference, btrim(p_reason))
  );

  return jsonb_build_object('late_entry_id', p_id, 'status', 'rejected');
end;
$function$;

revoke all on function public.reject_late_entry from public, anon;
grant execute on function public.reject_late_entry to authenticated, service_role;

-- 7. Approving and posting a late entry (Owner and Supa Admin only)
create or replace function public.approve_and_post_late_entry(
  p_id                uuid,
  p_shift_resolution  text default null,
  p_notes             text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz         text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role        text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_uid         uuid := auth.uid();
  e             public.late_entries%rowtype;
  v_order_id    uuid;
  v_cur_open_shift uuid;
  it            record;
  v_order_stat  text := 'paid';
  v_resolution  text;
begin
  if v_biz is null or v_role not in ('owner', 'supa_admin') then
    raise exception 'Only business owners can approve and post late entries.';
  end if;
  if not (select public.business_has_access(v_biz)) then
    raise exception 'Your plan has ended.';
  end if;

  select * into e from public.late_entries where id = p_id and business_id = v_biz for update;
  if not found then
    raise exception 'Late entry record not found.';
  end if;
  if e.status = 'posted' then
    return jsonb_build_object('order_id', e.posted_order_id, 'already_posted', true);
  end if;
  if e.status not in ('submitted', 'needs_shift_review') then
    raise exception 'This late entry is % and cannot be approved.', e.status;
  end if;

  -- Determine shift context
  select id into v_cur_open_shift from public.cash_drawers where business_id = v_biz and status = 'open' limit 1;

  if e.status = 'needs_shift_review' or v_cur_open_shift is null then
    if p_shift_resolution not in ('closed_shift_included', 'closed_shift_late_cash') then
      raise exception 'Closed-shift entries require an explicit resolution: closed_shift_included or closed_shift_late_cash.';
    end if;
    v_resolution := p_shift_resolution;

    -- If late cash was not in the original counted physical cash, record adjustment against shift
    if v_resolution = 'closed_shift_late_cash' and e.cash_kobo > 0 and e.source_shift_id is not null then
      insert into public.cash_drawer_adjustments (
        business_id, drawer_id, amount_kobo, reason, recorded_by
      ) values (
        v_biz, e.source_shift_id, e.cash_kobo,
        format('Late cash from paper ref %s', e.paper_reference), v_uid
      );
    end if;
  else
    v_resolution := 'open_shift_direct';
  end if;

  -- Payment status: pure transfer or split transfer portion starts as transfer_pending
  if e.payment_method = 'transfer' then
    v_order_stat := 'transfer_pending';
  else
    v_order_stat := 'paid';
  end if;

  -- 1. Create authoritative order in public.orders
  perform set_config('app.payment_internal', '1', true);
  insert into public.orders (
    business_id, channel, price_tier, subtotal_kobo, total_kobo,
    status, payment_method, cash_amount_kobo, transfer_amount_kobo,
    created_by, client_sale_id, is_late_entry, actual_sold_at,
    paper_reference, late_delay_seconds, late_entered_by, late_approved_by
  ) values (
    v_biz, e.channel, e.price_tier, e.total_kobo, e.total_kobo,
    v_order_stat, e.payment_method, e.cash_kobo, e.transfer_kobo,
    e.entered_by, e.client_sale_id, true, e.actual_sold_at,
    e.paper_reference, e.delay_seconds, e.entered_by, v_uid
  ) returning id into v_order_id;
  perform set_config('app.payment_internal', '', true);

  -- 2. Insert authoritative order items (triggers stock reduction on made-to-order dishes)
  for it in select * from public.late_entry_items where late_entry_id = p_id loop
    insert into public.order_items (
      business_id, order_id, recipe_id, quantity, unit_price_kobo
    ) values (
      v_biz, v_order_id, it.recipe_id, it.quantity, it.unit_price_kobo
    );
  end loop;

  -- 3. Mark late entry posted
  perform set_config('app.late_internal', '1', true);
  update public.late_entries
     set status = 'posted',
         approved_by = v_uid,
         approved_at = now(),
         posted_order_id = v_order_id,
         shift_resolution = v_resolution,
         notes = coalesce(p_notes, notes)
   where id = p_id;
  perform set_config('app.late_internal', '', true);

  -- 4. Audit trail
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (
    v_biz, v_uid, v_role, 'late_entry_posted', 'orders', v_order_id,
    format('Late entry "%s" approved and posted into order %s (shift: %s, amount ₦%s)',
      e.paper_reference, v_order_id, v_resolution, to_char(e.total_kobo / 100.0, 'FM999,999,990.00'))
  );

  return jsonb_build_object(
    'late_entry_id', p_id,
    'order_id', v_order_id,
    'status', 'posted',
    'shift_resolution', v_resolution,
    'already_posted', false
  );
end;
$function$;

revoke all on function public.approve_and_post_late_entry from public, anon;
grant execute on function public.approve_and_post_late_entry to authenticated, service_role;

commit;
