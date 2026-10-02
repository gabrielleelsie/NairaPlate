-- NairaPlate append-only records, step 4, part A: purchases that can be reversed, never edited.
-- Run once in the Supabase SQL editor, BEFORE the new purchases screen is released. Safe to re-run. Rollback: 20261022_purchase_ledger_a_rollback.sql
-- A purchase is saved with a snapshot of what the ingredient looked like just before it (price, grade, season, stock added). An owner can
-- reverse it, with a reason, ONLY if it is the latest purchase of that ingredient and nobody has changed the ingredient's price since.
-- The reversal is a new entry beside the original (minus quantity, minus amount). The original is never edited.
-- Purchases saved before this change have no snapshot, so they can never be reversed.
-- Needs ledger_block_change() (20261019) and the supplier ledger (20261020). Until part B, the old direct write policies on purchases remain.

-- 1. More about each purchase.
alter table public.purchases
  add column if not exists kind             text not null default 'purchase',
  add column if not exists reverses_id      uuid references public.purchases(id),
  add column if not exists reason           text,
  add column if not exists recorded_by_name text,
  add column if not exists base_qty         numeric,
  add column if not exists price_set_at     timestamptz,
  add column if not exists before_state     jsonb;
alter table public.purchases drop constraint if exists purchases_kind_check;
alter table public.purchases add constraint purchases_kind_check check (kind in ('purchase','reversal'));
alter table public.purchases drop constraint if exists purchases_amount_rule;
alter table public.purchases add constraint purchases_amount_rule check ((kind = 'purchase' and qty > 0 and total_kobo > 0) or (kind = 'reversal' and qty < 0 and total_kobo < 0)) not valid;
alter table public.purchases drop constraint if exists purchases_reversal_rule;
alter table public.purchases add constraint purchases_reversal_rule check ((kind = 'reversal') = (reverses_id is not null)) not valid;
alter table public.purchases drop constraint if exists purchases_reason_rule;
alter table public.purchases add constraint purchases_reason_rule check (kind = 'purchase' or length(btrim(coalesce(reason, ''))) >= 5) not valid;
create unique index if not exists purchases_one_reversal on public.purchases (reverses_id) where reverses_id is not null;

-- 2. Frozen: nobody signed in can change or delete a purchase (the server and the SQL editor can, for admin work only).
drop trigger if exists purchases_no_change on public.purchases;
create trigger purchases_no_change before update or delete on public.purchases
  for each row execute function public.ledger_block_change();

-- 3. Rules on every new reversal, whoever writes it: owner only, one purchase, same ingredient, the exact minus amount, once.
create or replace function public.purchases_check()
returns trigger language plpgsql set search_path to 'public' as $function$
declare o public.purchases%rowtype;
begin
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
drop trigger if exists purchases_check on public.purchases;
create trigger purchases_check before insert on public.purchases
  for each row execute function public.purchases_check();

-- 4. The supplier ledger gets a fourth entry type: a credit purchase that was reversed (it lowers what you owe).
alter table public.supplier_transactions drop constraint if exists supplier_transactions_type_check;
alter table public.supplier_transactions add constraint supplier_transactions_type_check check (type in ('purchase_on_credit','payment','reversal','purchase_reversal'));
alter table public.supplier_transactions drop constraint if exists supplier_transactions_reversal_rule;
alter table public.supplier_transactions add constraint supplier_transactions_reversal_rule check ((type in ('reversal','purchase_reversal')) = (reverses_id is not null)) not valid;
alter table public.supplier_transactions drop constraint if exists supplier_transactions_reason_rule;
alter table public.supplier_transactions add constraint supplier_transactions_reason_rule check (type not in ('reversal','purchase_reversal') or length(btrim(coalesce(reason, ''))) >= 5) not valid;

create or replace function public.supplier_transactions_check_reversal()
returns trigger language plpgsql set search_path to 'public' as $function$
declare o public.supplier_transactions%rowtype;
begin
  if NEW.type not in ('reversal','purchase_reversal') then return NEW; end if;
  if auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
    raise exception 'Only an owner can reverse this.';
  end if;
  select * into o from public.supplier_transactions where id = NEW.reverses_id;
  if not found then raise exception 'The entry being reversed was not found.'; end if;
  if NEW.type = 'reversal' and o.type <> 'payment' then raise exception 'Only a payment can be reversed.'; end if;
  if NEW.type = 'purchase_reversal' and o.type <> 'purchase_on_credit' then raise exception 'Only a credit purchase can be reversed this way.'; end if;
  if o.supplier_id <> NEW.supplier_id or o.business_id <> NEW.business_id then raise exception 'That entry belongs to a different supplier.'; end if;
  if NEW.amount_kobo <> o.amount_kobo then raise exception 'A reversal must be for exactly the amount of the entry.'; end if;
  return NEW;
end $function$;

create or replace function public.supplier_balance_kobo(p_business_id text, p_supplier_id uuid)
returns bigint language sql stable security definer set search_path to 'public' as $function$
  select coalesce(sum(case type when 'purchase_on_credit' then amount_kobo when 'payment' then -amount_kobo when 'reversal' then amount_kobo when 'purchase_reversal' then -amount_kobo else 0 end), 0)::bigint
    from public.supplier_transactions where business_id = p_business_id and supplier_id = p_supplier_id
$function$;
revoke all on function public.supplier_balance_kobo(text, uuid) from public, anon, authenticated;
grant execute on function public.supplier_balance_kobo(text, uuid) to service_role;

-- 5. Logging a purchase: same as before, and it now also saves the snapshot, the stock quantity added and who recorded it.
create or replace function public.log_purchase(p_ingredient_id uuid, p_qty numeric, p_market_unit text, p_total_kobo bigint, p_payment_method text, p_grade text, p_season text, p_raw_transcript text default null::text, p_supplier_id uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_ing  public.ingredients%rowtype;
  v_gp   public.ingredient_grade_prices%rowtype;
  v_unit text := lower(trim(p_market_unit));
  v_base text;
  v_base_qty numeric;
  v_conv numeric;
  v_new bigint;
  v_pid uuid;
  v_flag boolean := false;
  v_pct numeric;
  v_sup text;
  v_compare bigint;
  v_note text;
  v_name text;
  v_now timestamptz := now();
begin
  if v_biz is null or v_role is null or v_role not in ('owner','supa_admin','purchaser') then
    raise exception 'Only purchasers and owners can log purchases.';
  end if;
  if p_payment_method not in ('cash','transfer','credit') then
    raise exception 'Payment method must be cash, transfer or credit.';
  end if;
  if p_grade is null or p_grade not in ('A','B','C') then
    raise exception 'Choose a grade: A, B or C.';
  end if;
  if p_season is null or p_season not in ('plenty','normal','scarce') then
    raise exception 'Choose a season: Plenty, Normal or Scarce.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than 0.'; end if;
  if p_total_kobo is null or p_total_kobo <= 0 then raise exception 'Amount paid must be more than 0.'; end if;

  if p_supplier_id is not null then
    select name into v_sup from public.suppliers where id = p_supplier_id and business_id = v_biz;
    if not found then raise exception 'Supplier not found.'; end if;
  end if;

  select * into v_ing from public.ingredients
   where id = p_ingredient_id and business_id = v_biz
   for update;
  if not found then raise exception 'Ingredient not found.'; end if;

  v_base := lower(trim(v_ing.base_unit));

  if v_unit = v_base then
    v_base_qty := p_qty;
  else
    select base_qty into v_conv from public.unit_conversions
     where ingredient_id = v_ing.id and business_id = v_biz and lower(trim(market_unit)) = v_unit
     limit 1;
    if v_conv is not null then
      v_base_qty := p_qty * v_conv;
    elsif v_unit = 'g'  and v_base = 'kg' then v_base_qty := p_qty / 1000;
    elsif v_unit = 'kg' and v_base = 'g'  then v_base_qty := p_qty * 1000;
    elsif v_unit = 'ml' and v_base = 'l'  then v_base_qty := p_qty / 1000;
    elsif v_unit = 'l'  and v_base = 'ml' then v_base_qty := p_qty * 1000;
    else
      raise exception 'No conversion for "%" on % (base unit %). Add one on the Ingredients screen.',
        p_market_unit, v_ing.name, v_ing.base_unit;
    end if;
  end if;
  if v_base_qty is null or v_base_qty <= 0 then raise exception 'Converted quantity is zero.'; end if;

  v_new := round(p_total_kobo / v_base_qty);

  select * into v_gp from public.ingredient_grade_prices where ingredient_id = v_ing.id and grade = p_grade;
  if found then
    v_compare := v_gp.cost_kobo;
  else
    if v_ing.current_grade is null then
      v_compare := v_ing.current_cost_kobo;
    else
      v_note := 'first_of_grade';
    end if;
  end if;

  select display_name into v_name from public.staff_users where id = auth.uid();

  perform set_config('app.purchase_internal', '1', true);
  perform set_config('app.stock_reason', 'purchase', true);
  update public.ingredients
     set previous_cost_kobo = current_cost_kobo,
         current_cost_kobo  = v_new,
         current_grade      = p_grade,
         current_season     = p_season,
         stock_base_qty     = stock_base_qty + v_base_qty,
         price_updated_at   = v_now
   where id = v_ing.id;

  insert into public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
  values (v_ing.id, v_biz, p_grade, v_new, p_season, v_now)
  on conflict (ingredient_id, grade) do update set cost_kobo = excluded.cost_kobo, season = excluded.season, updated_at = v_now;

  insert into public.purchases
    (business_id, ingredient_id, qty, market_unit, total_kobo, payment_method, recorded_by, recorded_at, raw_transcript, supplier_id, grade, season,
     kind, recorded_by_name, base_qty, price_set_at, before_state)
  values
    (v_biz, v_ing.id, p_qty, p_market_unit, p_total_kobo, p_payment_method, auth.uid(), v_now, p_raw_transcript, p_supplier_id, p_grade, p_season,
     'purchase', coalesce(v_name, 'Staff'), v_base_qty, v_now,
     jsonb_build_object(
       'cost_kobo', v_ing.current_cost_kobo, 'previous_cost_kobo', v_ing.previous_cost_kobo,
       'grade', v_ing.current_grade, 'season', v_ing.current_season, 'price_updated_at', v_ing.price_updated_at,
       'grade_row', case when v_gp.ingredient_id is null then null
                         else jsonb_build_object('cost_kobo', v_gp.cost_kobo, 'season', v_gp.season, 'updated_at', v_gp.updated_at) end))
  returning id into v_pid;

  if p_supplier_id is not null and p_payment_method = 'credit' then
    insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo, purchase_id, note, recorded_by)
    values (v_biz, p_supplier_id, 'purchase_on_credit', p_total_kobo, v_pid,
            format('%s %s %s', p_qty, p_market_unit, v_ing.name), auth.uid());
  end if;

  if v_compare is not null and v_compare > 0 and v_new > v_compare * 1.05 then
    v_flag := true;
    v_pct := round((v_new - v_compare) * 100.0 / v_compare, 1);
    insert into public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
    values (v_biz, 'cr_spike', 'warn',
      format('%s (grade %s, %s season) price rose from ₦%s to ₦%s per %s (+%s%%).',
        v_ing.name, p_grade, p_season, to_char(v_compare / 100.0, 'FM999,999,990.00'),
        to_char(v_new / 100.0, 'FM999,999,990.00'), v_ing.base_unit, v_pct),
      'owner', false);
  end if;

  return jsonb_build_object(
    'purchase_id', v_pid, 'base_qty', v_base_qty,
    'previous_cost_kobo', v_ing.current_cost_kobo, 'current_cost_kobo', v_new,
    'flagged', v_flag, 'pct', v_pct,
    'grade', p_grade, 'season', p_season, 'previous_grade', v_ing.current_grade, 'compared_with_kobo', v_compare, 'note', v_note);
end;
$function$;

-- 6. Reversing a purchase. Owner only, a reason of 5 or more characters. Puts the ingredient back as it was, takes the stock back out
--    (it may go below zero; the screen warns), and lowers what is owed to the supplier if it was bought on credit.
create or replace function public.reverse_purchase(p_purchase_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text; p public.purchases%rowtype; i public.ingredients%rowtype; s public.suppliers%rowtype;
  v_snap jsonb; v_row jsonb; v_id uuid; v_stock numeric; v_txn uuid; v_bal bigint := null;
begin
  if v_biz is null or v_role not in ('owner','supa_admin') then raise exception 'Only an owner can reverse a purchase.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Type a reason of at least 5 characters.'; end if;
  select * into p from public.purchases where id = p_purchase_id and business_id = v_biz;
  if not found then raise exception 'Purchase not found.'; end if;
  if p.kind <> 'purchase' then raise exception 'Only a purchase can be reversed.'; end if;
  if p.before_state is null or p.price_set_at is null or p.base_qty is null then
    raise exception 'This purchase was recorded before reversals existed, so it cannot be reversed.';
  end if;
  select * into i from public.ingredients where id = p.ingredient_id and business_id = v_biz for update;
  if not found then raise exception 'Ingredient not found.'; end if;
  if exists (select 1 from public.purchases where reverses_id = p.id) then raise exception 'This purchase has already been reversed.'; end if;
  if i.price_updated_at is distinct from p.price_set_at then
    raise exception 'Cannot be reversed because a newer price or purchase exists for this ingredient.';
  end if;
  v_snap := p.before_state; v_row := v_snap -> 'grade_row';
  select display_name into v_name from public.staff_users where id = auth.uid();

  perform set_config('app.purchase_internal', '1', true);
  perform set_config('app.stock_reason', 'purchase_reversed', true);
  perform set_config('app.stock_ref', p.id::text, true);
  v_stock := i.stock_base_qty - p.base_qty;
  update public.ingredients
     set current_cost_kobo  = (v_snap ->> 'cost_kobo')::bigint,
         previous_cost_kobo = (v_snap ->> 'previous_cost_kobo')::bigint,
         current_grade      = v_snap ->> 'grade',
         current_season     = v_snap ->> 'season',
         price_updated_at   = nullif(v_snap ->> 'price_updated_at', '')::timestamptz,
         stock_base_qty     = v_stock
   where id = i.id;
  if p.grade is not null then
    if v_row is null or v_row = 'null'::jsonb then
      delete from public.ingredient_grade_prices where ingredient_id = i.id and grade = p.grade;
    else
      insert into public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
      values (i.id, v_biz, p.grade, (v_row ->> 'cost_kobo')::bigint, v_row ->> 'season', (v_row ->> 'updated_at')::timestamptz)
      on conflict (ingredient_id, grade) do update set cost_kobo = excluded.cost_kobo, season = excluded.season, updated_at = excluded.updated_at;
    end if;
  end if;

  insert into public.purchases
    (business_id, ingredient_id, qty, market_unit, total_kobo, payment_method, recorded_by, recorded_at, supplier_id, grade, season,
     kind, reverses_id, reason, recorded_by_name, base_qty)
  values
    (v_biz, p.ingredient_id, -p.qty, p.market_unit, -p.total_kobo, p.payment_method, auth.uid(), now(), p.supplier_id, p.grade, p.season,
     'reversal', p.id, btrim(p_reason), coalesce(v_name, 'Owner'), -p.base_qty)
  returning id into v_id;

  if p.supplier_id is not null and p.payment_method = 'credit' then
    select id into v_txn from public.supplier_transactions where purchase_id = p.id and type = 'purchase_on_credit' and business_id = v_biz;
    if v_txn is not null then
      select * into s from public.suppliers where id = p.supplier_id for update;
      insert into public.supplier_transactions (business_id, supplier_id, type, amount_kobo, purchase_id, reverses_id, reason, note, recorded_by, recorded_by_name)
      values (v_biz, p.supplier_id, 'purchase_reversal', p.total_kobo, p.id, v_txn, btrim(p_reason), 'Purchase reversed', auth.uid(), coalesce(v_name, 'Owner'));
      v_bal := public.supplier_balance_kobo(v_biz, p.supplier_id);
    end if;
  end if;

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, auth.uid(), v_role, 'purchase_reversed', 'purchases', v_id,
          format('%s reversed a purchase of %s %s %s (%s kobo): %s', coalesce(v_name, 'Owner'), p.qty, p.market_unit, i.name, p.total_kobo, btrim(p_reason)));
  return jsonb_build_object('reversal_id', v_id, 'stock_after', v_stock, 'below_zero', v_stock < 0,
                            'supplier_balance_kobo', v_bal, 'supplier_owes_you_kobo', case when v_bal is not null and v_bal < 0 then -v_bal else 0 end);
end $function$;
revoke all on function public.reverse_purchase(uuid, text) from public, anon;
grant execute on function public.reverse_purchase(uuid, text) to authenticated, service_role;
