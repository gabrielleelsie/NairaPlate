-- ============================================================
-- NairaPlate schema: multi-tenant (business_id) with strict RLS
-- ============================================================

CREATE TABLE public.businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_profile TEXT,
  target_margin_bps INTEGER NOT NULL DEFAULT 3500,
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('supa_admin','owner','purchaser','cook','cashier')),
  display_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  pin_hash TEXT,
  pin_salt TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  base_unit TEXT NOT NULL,
  current_cost_kobo BIGINT NOT NULL DEFAULT 0,
  previous_cost_kobo BIGINT NOT NULL DEFAULT 0,
  stock_base_qty NUMERIC NOT NULL DEFAULT 0,
  min_threshold_qty NUMERIC NOT NULL DEFAULT 0,
  supplier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  market_unit TEXT NOT NULL,
  base_qty NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ingredient_id, market_unit)
);

CREATE TABLE public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  yield_portions NUMERIC NOT NULL DEFAULT 1,
  selling_price_kobo BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty NUMERIC NOT NULL,
  market_unit TEXT NOT NULL,
  total_kobo BIGINT NOT NULL,
  payment_method TEXT,
  recorded_by UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel TEXT,
  price_tier TEXT,
  subtotal_kobo BIGINT NOT NULL DEFAULT 0,
  total_kobo BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid','cancelled','refunded')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit_price_kobo BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE RESTRICT,
  scale_factor NUMERIC NOT NULL DEFAULT 1,
  actual_yield NUMERIC,
  ingredient_cost_kobo BIGINT NOT NULL DEFAULT 0,
  packaging_kobo BIGINT NOT NULL DEFAULT 0,
  utilities_kobo BIGINT NOT NULL DEFAULT 0,
  logged_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.wastage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  cost_kobo BIGINT NOT NULL DEFAULT 0,
  reason TEXT,
  logged_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone TEXT,
  amount_kobo BIGINT NOT NULL DEFAULT 0,
  settled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.catering_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone TEXT,
  event_date DATE,
  deposit_kobo BIGINT NOT NULL DEFAULT 0,
  total_contract_kobo BIGINT NOT NULL DEFAULT 0,
  items_summary TEXT,
  settled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cash_drawers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  opened_by UUID,
  opening_float_kobo BIGINT NOT NULL DEFAULT 0,
  closing_counted_kobo BIGINT,
  expected_cash_kobo BIGINT,
  discrepancy_kobo BIGINT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE public.channel_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  gross_sales_kobo BIGINT NOT NULL DEFAULT 0,
  commission_kobo BIGINT NOT NULL DEFAULT 0,
  net_payout_kobo BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.margin_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  message TEXT,
  role TEXT,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.price_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  previous_price_kobo BIGINT,
  suggested_price_kobo BIGINT,
  decision TEXT,
  decided_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant key indexes
CREATE INDEX idx_staff_users_business_id ON public.staff_users(business_id);
CREATE INDEX idx_ingredients_business_id ON public.ingredients(business_id);
CREATE INDEX idx_unit_conversions_business_id ON public.unit_conversions(business_id);
CREATE INDEX idx_recipes_business_id ON public.recipes(business_id);
CREATE INDEX idx_recipe_items_business_id ON public.recipe_items(business_id);
CREATE INDEX idx_purchases_business_id ON public.purchases(business_id);
CREATE INDEX idx_orders_business_id ON public.orders(business_id);
CREATE INDEX idx_order_items_business_id ON public.order_items(business_id);
CREATE INDEX idx_batches_business_id ON public.batches(business_id);
CREATE INDEX idx_wastage_logs_business_id ON public.wastage_logs(business_id);
CREATE INDEX idx_customer_credits_business_id ON public.customer_credits(business_id);
CREATE INDEX idx_catering_deposits_business_id ON public.catering_deposits(business_id);
CREATE INDEX idx_cash_drawers_business_id ON public.cash_drawers(business_id);
CREATE INDEX idx_channel_payouts_business_id ON public.channel_payouts(business_id);
CREATE INDEX idx_margin_flags_business_id ON public.margin_flags(business_id);
CREATE INDEX idx_price_decisions_business_id ON public.price_decisions(business_id);

-- Data API grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_users TO authenticated;
GRANT ALL ON public.staff_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredients TO authenticated;
GRANT ALL ON public.ingredients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_conversions TO authenticated;
GRANT ALL ON public.unit_conversions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_items TO authenticated;
GRANT ALL ON public.recipe_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT ALL ON public.batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wastage_logs TO authenticated;
GRANT ALL ON public.wastage_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_credits TO authenticated;
GRANT ALL ON public.customer_credits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_deposits TO authenticated;
GRANT ALL ON public.catering_deposits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_drawers TO authenticated;
GRANT ALL ON public.cash_drawers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_payouts TO authenticated;
GRANT ALL ON public.channel_payouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.margin_flags TO authenticated;
GRANT ALL ON public.margin_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_decisions TO authenticated;
GRANT ALL ON public.price_decisions TO service_role;

-- Row Level Security
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wastage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_decisions ENABLE ROW LEVEL SECURITY;

-- ================= Policies =================

-- businesses
CREATE POLICY "businesses_select" ON public.businesses FOR SELECT TO authenticated USING (id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser','cook','cashier'));
CREATE POLICY "businesses_insert" ON public.businesses FOR INSERT TO authenticated WITH CHECK (id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "businesses_update" ON public.businesses FOR UPDATE TO authenticated USING (id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "businesses_delete" ON public.businesses FOR DELETE TO authenticated USING (id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- staff_users
CREATE POLICY "staff_users_select" ON public.staff_users FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "staff_users_insert" ON public.staff_users FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "staff_users_update" ON public.staff_users FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "staff_users_delete" ON public.staff_users FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- ingredients
CREATE POLICY "ingredients_select" ON public.ingredients FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser','cook','cashier'));
CREATE POLICY "ingredients_insert" ON public.ingredients FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "ingredients_update" ON public.ingredients FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "ingredients_delete" ON public.ingredients FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- unit_conversions
CREATE POLICY "unit_conversions_select" ON public.unit_conversions FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser','cook','cashier'));
CREATE POLICY "unit_conversions_insert" ON public.unit_conversions FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "unit_conversions_update" ON public.unit_conversions FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "unit_conversions_delete" ON public.unit_conversions FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- recipes
CREATE POLICY "recipes_select" ON public.recipes FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser','cook','cashier'));
CREATE POLICY "recipes_insert" ON public.recipes FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "recipes_update" ON public.recipes FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "recipes_delete" ON public.recipes FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- recipe_items
CREATE POLICY "recipe_items_select" ON public.recipe_items FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser','cook','cashier'));
CREATE POLICY "recipe_items_insert" ON public.recipe_items FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "recipe_items_update" ON public.recipe_items FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "recipe_items_delete" ON public.recipe_items FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- purchases
CREATE POLICY "purchases_select" ON public.purchases FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "purchases_insert" ON public.purchases FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','purchaser'));
CREATE POLICY "purchases_update" ON public.purchases FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "purchases_delete" ON public.purchases FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- orders
CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "orders_insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "orders_delete" ON public.orders FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- order_items
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "order_items_update" ON public.order_items FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "order_items_delete" ON public.order_items FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- batches
CREATE POLICY "batches_select" ON public.batches FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "batches_insert" ON public.batches FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook'));
CREATE POLICY "batches_update" ON public.batches FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "batches_delete" ON public.batches FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- wastage_logs
CREATE POLICY "wastage_logs_select" ON public.wastage_logs FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook','purchaser'));
CREATE POLICY "wastage_logs_insert" ON public.wastage_logs FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cook','purchaser'));
CREATE POLICY "wastage_logs_update" ON public.wastage_logs FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "wastage_logs_delete" ON public.wastage_logs FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- customer_credits
CREATE POLICY "customer_credits_select" ON public.customer_credits FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "customer_credits_insert" ON public.customer_credits FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "customer_credits_update" ON public.customer_credits FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "customer_credits_delete" ON public.customer_credits FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- catering_deposits
CREATE POLICY "catering_deposits_select" ON public.catering_deposits FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "catering_deposits_insert" ON public.catering_deposits FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "catering_deposits_update" ON public.catering_deposits FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "catering_deposits_delete" ON public.catering_deposits FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- cash_drawers
CREATE POLICY "cash_drawers_select" ON public.cash_drawers FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "cash_drawers_insert" ON public.cash_drawers FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "cash_drawers_update" ON public.cash_drawers FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner','cashier'));
CREATE POLICY "cash_drawers_delete" ON public.cash_drawers FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- channel_payouts (owner / supa_admin only)
CREATE POLICY "channel_payouts_select" ON public.channel_payouts FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "channel_payouts_insert" ON public.channel_payouts FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "channel_payouts_update" ON public.channel_payouts FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "channel_payouts_delete" ON public.channel_payouts FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- margin_flags (owner / supa_admin only)
CREATE POLICY "margin_flags_select" ON public.margin_flags FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "margin_flags_insert" ON public.margin_flags FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "margin_flags_update" ON public.margin_flags FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "margin_flags_delete" ON public.margin_flags FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));

-- price_decisions (owner / supa_admin only)
CREATE POLICY "price_decisions_select" ON public.price_decisions FOR SELECT TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "price_decisions_insert" ON public.price_decisions FOR INSERT TO authenticated WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "price_decisions_update" ON public.price_decisions FOR UPDATE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner')) WITH CHECK (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));
CREATE POLICY "price_decisions_delete" ON public.price_decisions FOR DELETE TO authenticated USING (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id') AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('supa_admin','owner'));