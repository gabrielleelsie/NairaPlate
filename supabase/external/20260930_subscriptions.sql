-- NairaPlate: 7-day trial, paid terms, automatic lockout, staff PIN protection.
-- Target: external project ckklehqascyglqnqtwpn ONLY. Run in its SQL editor.
-- Lovable Cloud never runs files in supabase/external/.
-- One transaction: it fully applies or changes nothing.
BEGIN;

-- 1. businesses: billing columns ------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN access_ends_at timestamptz,
  ADD COLUMN plan text CHECK (plan IN ('trial','monthly','quarterly','yearly')),
  ADD COLUMN trial_started_at timestamptz;

-- 2. subscription_payments (server-only) ----------------------------------
CREATE TABLE public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL REFERENCES public.businesses(id),
  plan text NOT NULL CHECK (plan IN ('monthly','quarterly','yearly')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  payment_reference text NOT NULL,
  paid_on date NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.subscription_payments FROM anon, authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) can read or write.
CREATE INDEX subscription_payments_business_created_idx
  ON public.subscription_payments (business_id, created_at DESC);

-- 3. Access helper --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_has_access(bid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = bid AND b.status = 'approved' AND b.access_ends_at > now()
  )
$$;
REVOKE ALL ON FUNCTION public.business_has_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_has_access(text) TO authenticated, service_role;

-- 4. Extend the existing guard (everything it did before is kept unchanged) --
CREATE OR REPLACE FUNCTION public.businesses_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
BEGIN
  -- NEW: billing fields change only through the server (service role, no auth.uid()).
  IF auth.uid() IS NOT NULL AND (NEW.access_ends_at IS DISTINCT FROM OLD.access_ends_at
        OR NEW.plan IS DISTINCT FROM OLD.plan
        OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at) THEN
    RAISE EXCEPTION 'Billing and status fields can only be changed by NairaPlate';
  END IF;

  -- Unchanged from today.
  IF v_role = 'platform_admin' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.region_profile IS DISTINCT FROM OLD.region_profile
       OR NEW.target_margin_bps IS DISTINCT FROM OLD.target_margin_bps
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A platform admin can only change a business''s status.';
    END IF;
    NEW.reviewed_at := now(); NEW.reviewed_by := auth.uid();
    IF NEW.status NOT IN ('rejected','suspended') THEN NEW.rejection_reason := NULL; END IF;
  ELSIF auth.uid() IS NOT NULL AND (NEW.status IS DISTINCT FROM OLD.status
        OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
        OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by) THEN
    RAISE EXCEPTION 'Only the platform admin can change a business''s status.';
  END IF;

  -- NEW: trial starts in the database on pending -> approved, whoever approves.
  -- Ends 23:59:59 Africa/Lagos on day 7, approval day = day 1.
  IF OLD.status = 'pending' AND NEW.status = 'approved' AND NEW.access_ends_at IS NULL THEN
    NEW.plan := 'trial';
    NEW.trial_started_at := now();
    NEW.access_ends_at := (((now() AT TIME ZONE 'Africa/Lagos')::date + 6) + time '23:59:59') AT TIME ZONE 'Africa/Lagos';
  END IF;

  RETURN NEW;
END $function$;

-- 5. Access check on 81 rules (78 business-data rules + 3 businesses rules) --
-- Existing conditions kept exactly; one check per query via (SELECT ...).
-- audit_logs (2)
ALTER POLICY audit_logs_insert ON public.audit_logs WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text, 'cook'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY audit_logs_select ON public.audit_logs USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- batches (4)
ALTER POLICY batches_select ON public.batches USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY batches_insert ON public.batches WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY batches_update ON public.batches USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY batches_delete ON public.batches USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- cash_drawers (4)
ALTER POLICY cash_drawers_select ON public.cash_drawers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY cash_drawers_insert ON public.cash_drawers WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY cash_drawers_update ON public.cash_drawers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY cash_drawers_delete ON public.cash_drawers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- catering_deposits (4)
ALTER POLICY catering_deposits_select ON public.catering_deposits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY catering_deposits_insert ON public.catering_deposits WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY catering_deposits_update ON public.catering_deposits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY catering_deposits_delete ON public.catering_deposits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- channel_payouts (4)
ALTER POLICY channel_payouts_select ON public.channel_payouts USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY channel_payouts_insert ON public.channel_payouts WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY channel_payouts_update ON public.channel_payouts USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY channel_payouts_delete ON public.channel_payouts USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- customer_credits (4)
ALTER POLICY customer_credits_select ON public.customer_credits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY customer_credits_insert ON public.customer_credits WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY customer_credits_update ON public.customer_credits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY customer_credits_delete ON public.customer_credits USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- ingredients (4)
ALTER POLICY ingredients_select ON public.ingredients USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text, 'cook'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY ingredients_insert ON public.ingredients WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY ingredients_update ON public.ingredients USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY ingredients_delete ON public.ingredients USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- margin_flags (4)
ALTER POLICY margin_flags_select ON public.margin_flags USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY margin_flags_insert ON public.margin_flags WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY margin_flags_update ON public.margin_flags USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY margin_flags_delete ON public.margin_flags USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- order_adjustments (4)
ALTER POLICY order_adjustments_select ON public.order_adjustments USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_adjustments_insert ON public.order_adjustments WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_adjustments_update ON public.order_adjustments USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_adjustments_delete ON public.order_adjustments USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- order_items (4)
ALTER POLICY order_items_select ON public.order_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_items_insert ON public.order_items WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_items_update ON public.order_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY order_items_delete ON public.order_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- orders (4)
ALTER POLICY orders_select ON public.orders USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY orders_insert ON public.orders WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY orders_update ON public.orders USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY orders_delete ON public.orders USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- price_decisions (4)
ALTER POLICY price_decisions_select ON public.price_decisions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY price_decisions_insert ON public.price_decisions WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY price_decisions_update ON public.price_decisions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY price_decisions_delete ON public.price_decisions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- purchases (4)
ALTER POLICY purchases_select ON public.purchases USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY purchases_insert ON public.purchases WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY purchases_update ON public.purchases USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY purchases_delete ON public.purchases USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- recipe_items (4)
ALTER POLICY recipe_items_select ON public.recipe_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text, 'cook'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipe_items_insert ON public.recipe_items WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipe_items_update ON public.recipe_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipe_items_delete ON public.recipe_items USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- recipes (4)
ALTER POLICY recipes_select ON public.recipes USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text, 'cook'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipes_insert ON public.recipes WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipes_update ON public.recipes USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY recipes_delete ON public.recipes USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- staff_users (4)
ALTER POLICY staff_users_select ON public.staff_users USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY staff_users_insert ON public.staff_users WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY staff_users_update ON public.staff_users USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY staff_users_delete ON public.staff_users USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- supplier_transactions (4)
ALTER POLICY supplier_transactions_select ON public.supplier_transactions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY supplier_transactions_insert ON public.supplier_transactions WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY supplier_transactions_update ON public.supplier_transactions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY supplier_transactions_delete ON public.supplier_transactions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- suppliers (4)
ALTER POLICY suppliers_select ON public.suppliers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY suppliers_insert ON public.suppliers WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY suppliers_update ON public.suppliers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY suppliers_delete ON public.suppliers USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- unit_conversions (4)
ALTER POLICY unit_conversions_select ON public.unit_conversions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text, 'cook'::text, 'cashier'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY unit_conversions_insert ON public.unit_conversions WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY unit_conversions_update ON public.unit_conversions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY unit_conversions_delete ON public.unit_conversions USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- wastage_logs (4)
ALTER POLICY wastage_logs_select ON public.wastage_logs USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY wastage_logs_insert ON public.wastage_logs WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text, 'cook'::text, 'purchaser'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY wastage_logs_update ON public.wastage_logs USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY wastage_logs_delete ON public.wastage_logs USING ((business_id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
-- businesses (3; businesses_select and both platform admin rules untouched)
ALTER POLICY businesses_insert ON public.businesses WITH CHECK ((id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY businesses_update ON public.businesses USING ((id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)))) WITH CHECK ((id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));
ALTER POLICY businesses_delete ON public.businesses USING ((id = ((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text)) AND (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = ANY (ARRAY['supa_admin'::text, 'owner'::text])) AND (SELECT public.business_has_access(((auth.jwt() -> 'app_metadata'::text) ->> 'business_id'::text))));

-- 6. Protect staff PINs ---------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.staff_users FROM authenticated, anon;
GRANT SELECT (id, business_id, role, display_name, phone, email, is_active, created_at)
  ON public.staff_users TO authenticated;
-- pin_hash, pin_salt, failed_attempts, locked_until: not granted. service_role unchanged.

-- 7. Backfill: approved businesses get a 7-day trial (today = day 1) -------
UPDATE public.businesses
SET plan = 'trial',
    trial_started_at = now(),
    access_ends_at = (((now() AT TIME ZONE 'Africa/Lagos')::date + 6) + time '23:59:59') AT TIME ZONE 'Africa/Lagos'
WHERE status = 'approved';

-- 8. Self-check: abort everything if the rule count is wrong ---------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%business_has_access%';
  IF n <> 81 THEN RAISE EXCEPTION 'Expected 81 rules with the access check, found %', n; END IF;
END $$;

COMMIT;
