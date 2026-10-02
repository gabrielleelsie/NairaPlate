-- Rollback for part A. REFUSES (changes nothing) if any purchase has been reversed, because that would lose real records.
-- Otherwise it removes the new columns (the saved "before" snapshots are lost; purchases themselves stay) and puts back the earlier
-- log_purchase, supplier balance and supplier guard. Run part B's rollback first if part B was run. All or nothing.
do $rb$ begin
  if exists (select 1 from public.purchases where kind = 'reversal') or exists (select 1 from public.supplier_transactions where type = 'purchase_reversal') then
    raise exception 'Reversed purchases exist. Rolling back would lose them. Nothing was changed.';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='purchases' and cmd in ('INSERT','UPDATE')) is false then
    raise exception 'Part B is still in place. Run 20261022_purchase_ledger_b_rollback.sql first. Nothing was changed.';
  end if;

  drop trigger if exists purchases_check on public.purchases;
  drop trigger if exists purchases_no_change on public.purchases;
  drop function if exists public.purchases_check();
  drop function if exists public.reverse_purchase(uuid, text);

  alter table public.supplier_transactions drop constraint if exists supplier_transactions_type_check;
  alter table public.supplier_transactions add constraint supplier_transactions_type_check check (type in ('purchase_on_credit','payment','reversal'));
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_reversal_rule;
  alter table public.supplier_transactions add constraint supplier_transactions_reversal_rule check ((type = 'reversal') = (reverses_id is not null)) not valid;
  alter table public.supplier_transactions drop constraint if exists supplier_transactions_reason_rule;
  alter table public.supplier_transactions add constraint supplier_transactions_reason_rule check (type <> 'reversal' or length(btrim(coalesce(reason, ''))) >= 5) not valid;

  execute $f$
  create or replace function public.supplier_transactions_check_reversal()
  returns trigger language plpgsql set search_path to 'public' as $function$
  declare o public.supplier_transactions%rowtype;
  begin
    if NEW.type <> 'reversal' then return NEW; end if;
    if auth.uid() is not null and coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '') not in ('owner','supa_admin') then
      raise exception 'Only an owner can reverse a payment.';
    end if;
    select * into o from public.supplier_transactions where id = NEW.reverses_id;
    if not found then raise exception 'The payment being reversed was not found.'; end if;
    if o.type <> 'payment' then raise exception 'Only a payment can be reversed.'; end if;
    if o.supplier_id <> NEW.supplier_id or o.business_id <> NEW.business_id then raise exception 'That payment belongs to a different supplier.'; end if;
    if NEW.amount_kobo <> o.amount_kobo then raise exception 'A reversal must be for exactly the amount of the payment.'; end if;
    return NEW;
  end $function$ $f$;

  execute $f$
  create or replace function public.supplier_balance_kobo(p_business_id text, p_supplier_id uuid)
  returns bigint language sql stable security definer set search_path to 'public' as $function$
    select coalesce(sum(case type when 'purchase_on_credit' then amount_kobo when 'payment' then -amount_kobo when 'reversal' then amount_kobo else 0 end), 0)::bigint
      from public.supplier_transactions where business_id = p_business_id and supplier_id = p_supplier_id
  $function$ $f$;

  execute $f$
  CREATE OR REPLACE FUNCTION public.log_purchase(p_ingredient_id uuid, p_qty numeric, p_market_unit text, p_total_kobo bigint, p_payment_method text, p_grade text, p_season text, p_raw_transcript text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
    v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
    v_ing  public.ingredients%ROWTYPE;
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
  BEGIN
    IF v_biz IS NULL OR v_role IS NULL OR v_role NOT IN ('owner','supa_admin','purchaser') THEN
      RAISE EXCEPTION 'Only purchasers and owners can log purchases.';
    END IF;
    IF p_payment_method NOT IN ('cash','transfer','credit') THEN
      RAISE EXCEPTION 'Payment method must be cash, transfer or credit.';
    END IF;
    IF p_grade IS NULL OR p_grade NOT IN ('A','B','C') THEN
      RAISE EXCEPTION 'Choose a grade: A, B or C.';
    END IF;
    IF p_season IS NULL OR p_season NOT IN ('plenty','normal','scarce') THEN
      RAISE EXCEPTION 'Choose a season: Plenty, Normal or Scarce.';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than 0.'; END IF;
    IF p_total_kobo IS NULL OR p_total_kobo <= 0 THEN RAISE EXCEPTION 'Amount paid must be more than 0.'; END IF;

    IF p_supplier_id IS NOT NULL THEN
      SELECT name INTO v_sup FROM public.suppliers WHERE id = p_supplier_id AND business_id = v_biz;
      IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found.'; END IF;
    END IF;

    SELECT * INTO v_ing FROM public.ingredients
     WHERE id = p_ingredient_id AND business_id = v_biz
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient not found.'; END IF;

    v_base := lower(trim(v_ing.base_unit));

    IF v_unit = v_base THEN
      v_base_qty := p_qty;
    ELSE
      SELECT base_qty INTO v_conv FROM public.unit_conversions
       WHERE ingredient_id = v_ing.id AND business_id = v_biz AND lower(trim(market_unit)) = v_unit
       LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_base_qty := p_qty * v_conv;
      ELSIF v_unit = 'g'  AND v_base = 'kg' THEN v_base_qty := p_qty / 1000;
      ELSIF v_unit = 'kg' AND v_base = 'g'  THEN v_base_qty := p_qty * 1000;
      ELSIF v_unit = 'ml' AND v_base = 'l'  THEN v_base_qty := p_qty / 1000;
      ELSIF v_unit = 'l'  AND v_base = 'ml' THEN v_base_qty := p_qty * 1000;
      ELSE
        RAISE EXCEPTION 'No conversion for "%" on % (base unit %). Add one on the Ingredients screen.',
          p_market_unit, v_ing.name, v_ing.base_unit;
      END IF;
    END IF;
    IF v_base_qty IS NULL OR v_base_qty <= 0 THEN RAISE EXCEPTION 'Converted quantity is zero.'; END IF;

    v_new := round(p_total_kobo / v_base_qty);

    SELECT cost_kobo INTO v_compare FROM public.ingredient_grade_prices
     WHERE ingredient_id = v_ing.id AND grade = p_grade;
    IF v_compare IS NULL THEN
      IF v_ing.current_grade IS NULL THEN
        v_compare := v_ing.current_cost_kobo;
      ELSE
        v_note := 'first_of_grade';
      END IF;
    END IF;

    PERFORM set_config('app.stock_reason', 'purchase', true);
    UPDATE public.ingredients
       SET previous_cost_kobo = current_cost_kobo,
           current_cost_kobo  = v_new,
           current_grade      = p_grade,
           current_season     = p_season,
           stock_base_qty     = stock_base_qty + v_base_qty,
           price_updated_at   = now()
     WHERE id = v_ing.id;

    INSERT INTO public.ingredient_grade_prices (ingredient_id, business_id, grade, cost_kobo, season, updated_at)
    VALUES (v_ing.id, v_biz, p_grade, v_new, p_season, now())
    ON CONFLICT (ingredient_id, grade) DO UPDATE SET cost_kobo = EXCLUDED.cost_kobo, season = EXCLUDED.season, updated_at = now();

    INSERT INTO public.purchases
      (business_id, ingredient_id, qty, market_unit, total_kobo, payment_method, recorded_by, recorded_at, raw_transcript, supplier_id, grade, season)
    VALUES
      (v_biz, v_ing.id, p_qty, p_market_unit, p_total_kobo, p_payment_method, auth.uid(), now(), p_raw_transcript, p_supplier_id, p_grade, p_season)
    RETURNING id INTO v_pid;

    IF p_supplier_id IS NOT NULL AND p_payment_method = 'credit' THEN
      INSERT INTO public.supplier_transactions (business_id, supplier_id, type, amount_kobo, purchase_id, note, recorded_by)
      VALUES (v_biz, p_supplier_id, 'purchase_on_credit', p_total_kobo, v_pid,
              format('%s %s %s', p_qty, p_market_unit, v_ing.name), auth.uid());
    END IF;

    IF v_compare IS NOT NULL AND v_compare > 0 AND v_new > v_compare * 1.05 THEN
      v_flag := true;
      v_pct := round((v_new - v_compare) * 100.0 / v_compare, 1);
      INSERT INTO public.margin_flags (business_id, flag_type, severity, message, role, acknowledged)
      VALUES (v_biz, 'cr_spike', 'warn',
        format('%s (grade %s, %s season) price rose from ₦%s to ₦%s per %s (+%s%%).',
          v_ing.name, p_grade, p_season, to_char(v_compare / 100.0, 'FM999,999,990.00'),
          to_char(v_new / 100.0, 'FM999,999,990.00'), v_ing.base_unit, v_pct),
        'owner', false);
    END IF;

    RETURN jsonb_build_object(
      'purchase_id', v_pid, 'base_qty', v_base_qty,
      'previous_cost_kobo', v_ing.current_cost_kobo, 'current_cost_kobo', v_new,
      'flagged', v_flag, 'pct', v_pct,
      'grade', p_grade, 'season', p_season, 'previous_grade', v_ing.current_grade, 'compared_with_kobo', v_compare, 'note', v_note);
  END;
  $function$ $f$;

  alter table public.purchases drop constraint if exists purchases_amount_rule;
  alter table public.purchases drop constraint if exists purchases_reversal_rule;
  alter table public.purchases drop constraint if exists purchases_reason_rule;
  alter table public.purchases drop constraint if exists purchases_kind_check;
  drop index if exists public.purchases_one_reversal;
  alter table public.purchases
    drop column if exists before_state, drop column if exists price_set_at, drop column if exists base_qty,
    drop column if exists recorded_by_name, drop column if exists reason, drop column if exists reverses_id, drop column if exists kind;
end $rb$;
