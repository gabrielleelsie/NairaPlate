// NairaPlate P&L — the ONE place gross sales, cost of goods, gross margin and food cost % are calculated.
// Every screen that shows any of these numbers must call calculateBusinessPnl().
//
// RECIPE VERSIONS: each sold plate is costed with the EXACT recipe version it was sold under
// (order_items.recipe_version_id → that recipes row and its own recipe_items). Editing a recipe
// later creates a new version and never changes the cost of past sales.
//
// FROZEN COSTS: a sold line that carries cost_per_plate_kobo is used as-is and never recalculated.
// OLDER SALES with no frozen cost: costed at the ingredient prices in force at the sale time, from the
// ingredient price history (ingredient_price_history_for). This is a report-time estimate, never stored.
// If a price at that time is not known, that line falls back to today's price and the report says so.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRecipeCost, type CostConversion, type CostIngredient, type CostRecipeItem } from "@/lib/costing";
import { PriceHistoryIndex, normaliseHistoryRows, type PriceTrack } from "@/lib/ingredient-price-history";
import { DAY_MS, fromLagosWallClock, lagosDateKey, toLagosWallClock } from "@/lib/lagos-time";

export type DateRange = { from: Date; to: Date }; // inclusive from, exclusive to

export type PnlResult = {
  gross_sales_kobo: number;
  recipe_cost_of_goods_kobo: number;
  wastage_cost_kobo: number;
  cost_of_goods_kobo: number; // recipe cost of plates sold + wastage
  gross_margin_kobo: number;
  food_cost_percentage: number | null; // 0–100; null when there are no sales
  paid_orders: number;
  daily: { date: string; sales_kobo: number }[]; // sales trend, one entry per day in range
  warnings: string[]; // e.g. a sold recipe that can't be costed
  limitations: string[];
};

// Days are Nigeria calendar days (WAT), so a sale at 00:30 in Lagos counts on the right day.
const dayKey = (d: Date) => lagosDateKey(d);

type SoldItem = { recipe_id: string; recipe_version_id?: string | null; quantity: number; cost_per_plate_kobo?: number | string | null };

export async function calculateBusinessPnl(
  supabase: SupabaseClient,
  business_id: string,
  date_range: DateRange,
): Promise<PnlResult> {
  const from = date_range.from.toISOString();
  const to = date_range.to.toISOString();

  // Only 'paid' and 'partially_refunded' orders count. 'cancelled' (void) and 'refunded' count as ₦0.
  const ordersQuery = (cols: string) => supabase.from("orders")
    .select(`id,total_kobo,created_at,order_items(${cols})`)
    .eq("business_id", business_id).in("status", ["paid", "partially_refunded"])
    .gte("created_at", from).lt("created_at", to);

  const [ordersF, ordersV, wastage, ingredients, conversions, recipes, recipeItems, partials, gradePrices, priceHistory] = await Promise.all([
    ordersQuery("recipe_id,recipe_version_id,quantity,cost_per_plate_kobo"),
    ordersQuery("recipe_id,recipe_version_id,quantity"),
    supabase.from("wastage_logs").select("cost_kobo")
      .eq("business_id", business_id).gte("created_at", from).lt("created_at", to),
    supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").eq("business_id", business_id),
    supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty").eq("business_id", business_id),
    // ALL versions (old and current) — past sales need the version they were sold under.
    supabase.from("recipes").select("id,name,yield_portions,cost_grade").eq("business_id", business_id),
    supabase.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").eq("business_id", business_id),
    // Partial refunds per order. If the refunds table isn't set up yet, treat as no refunds.
    supabase.from("order_adjustments").select("order_id,adjustment_amount_kobo")
      .eq("business_id", business_id).eq("type", "partial_refund"),
    supabase.from("ingredient_grade_prices").select("ingredient_id,grade,cost_kobo").eq("business_id", business_id),
    // Owners/purchasers only; anyone else (or before the history script is run) gets an error and today's prices are used.
    supabase.rpc("ingredient_price_history_for", { p_ingredient: null, p_until: to }),
  ]);
  // Before the versioning script is run the column doesn't exist: fall back to recipe_id.
  // Newest column first (frozen cost), then the version column, then the oldest shape.
  const orders = !ordersF.error ? ordersF : !ordersV.error ? ordersV : await ordersQuery("recipe_id,quantity");
  const failed = [orders, wastage, ingredients, conversions, recipes, recipeItems].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const refundedByOrder = new Map<string, number>();
  for (const a of partials.error ? [] : partials.data ?? []) {
    refundedByOrder.set(a.order_id, (refundedByOrder.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo));
  }

  const gradeByIng = new Map<string, Record<string, number>>();
  for (const g of gradePrices.error ? [] : gradePrices.data ?? []) {
    gradeByIng.set(g.ingredient_id, { ...(gradeByIng.get(g.ingredient_id) ?? {}), [g.grade]: Number(g.cost_kobo) });
  }
  const ings: CostIngredient[] = (ingredients.data ?? []).map((i) => ({ ...i, current_cost_kobo: Number(i.current_cost_kobo), grade_prices: gradeByIng.get(i.id) }));
  const convs: CostConversion[] = (conversions.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) }));
  const items = (recipeItems.data ?? []) as (CostRecipeItem & { recipe_id: string })[];
  const warnings: string[] = [];

  // Exact (unrounded) cost per plate for EACH recipe version, via the shared costing function,
  // using that version's own ingredient lines and plates-it-makes.
  const perPlate = new Map<string, number>();
  for (const r of recipes.data ?? []) {
    const c = computeRecipeCost({
      items: items.filter((i) => i.recipe_id === r.id).map((i) => ({ ...i, quantity: Number(i.quantity) })),
      ingredients: ings, conversions: convs, yield_portions: Number(r.yield_portions), target_margin_bps: 0, grade: (r as { cost_grade?: string | null }).cost_grade ?? null,
    });
    if (c.errors.length) perPlate.set(r.id, NaN);
    else perPlate.set(r.id, c.total_ingredient_cost_kobo / Number(r.yield_portions));
  }
  const history = priceHistory.error ? null : new PriceHistoryIndex(normaliseHistoryRows(priceHistory.data as unknown[]));
  const recipeById = new Map((recipes.data ?? []).map((r) => [r.id, r]));
  const atTimeCache = new Map<string, { perPlate: number; gradeFallback: boolean } | null>();
  // Cost per plate of one recipe version at the prices in force at `at`. null = some price unknown at that time.
  const perPlateAt = (versionId: string, at: string) => {
    const key = `${versionId}|${at}`;
    if (atTimeCache.has(key)) return atTimeCache.get(key)!;
    const r = recipeById.get(versionId);
    let out: { perPlate: number; gradeFallback: boolean } | null = null;
    if (r && history) {
      const lines = items.filter((i) => i.recipe_id === versionId);
      const grade = ((r as { cost_grade?: string | null }).cost_grade ?? null) as PriceTrack | null;
      let gradeFallback = false;
      const atIngs: CostIngredient[] = [];
      let known = true;
      for (const ing of ings) {
        if (!lines.some((l) => l.ingredient_id === ing.id)) continue;
        const cur = history.priceAt(ing.id, "current", at);
        if (cur.cost_kobo === null) { known = false; break; }
        const gp: Record<string, number> = {};
        if (grade) {
          const g = history.priceAt(ing.id, grade, at);
          if (g.cost_kobo !== null) gp[grade] = g.cost_kobo; else gradeFallback = true;
        }
        atIngs.push({ ...ing, current_cost_kobo: cur.cost_kobo, grade_prices: gp });
      }
      if (known) {
        const c = computeRecipeCost({
          items: lines.map((i) => ({ ...i, quantity: Number(i.quantity) })),
          ingredients: atIngs, conversions: convs, yield_portions: Number(r.yield_portions), target_margin_bps: 0, grade,
        });
        if (!c.errors.length) out = { perPlate: c.total_ingredient_cost_kobo / Number(r.yield_portions), gradeFallback };
      }
    }
    atTimeCache.set(key, out);
    return out;
  };
  const nameById = new Map((recipes.data ?? []).map((r) => [r.id, r.name as string]));

  // Daily buckets across the whole range, so days with no sales show as 0 on the chart.
  const daily = new Map<string, number>();
  for (let t = date_range.from.getTime(); t < date_range.to.getTime(); t += DAY_MS) daily.set(dayKey(new Date(t)), 0);

  let gross_sales_kobo = 0;
  let recipeCost = 0;
  let atSaleTime = 0; // no frozen cost: estimated from the prices in force at the sale time
  let gradeFallbackLines = 0; // ...but a chosen grade had no price then, so the latest price at that time was used
  let estimated = 0; // no frozen cost and a price at that time is unknown: costed at today's prices
  for (const o of (orders.data ?? []) as unknown as { id: string; total_kobo: number; created_at: string; order_items: SoldItem[] | null }[]) {
    // Net sale = total minus every partial refund on that order.
    const total = Number(o.total_kobo) - (refundedByOrder.get(o.id) ?? 0);
    gross_sales_kobo += total;
    const k = dayKey(new Date(o.created_at));
    daily.set(k, (daily.get(k) ?? 0) + total);
    for (const it of o.order_items ?? []) {
      // A sale made after grade costing went live carries its own frozen cost per plate: use it as it is.
      if (it.cost_per_plate_kobo !== null && it.cost_per_plate_kobo !== undefined) {
        recipeCost += Number(it.cost_per_plate_kobo) * Number(it.quantity);
        continue;
      }
      const versionId = it.recipe_version_id ?? it.recipe_id; // the version stamped at sale time
      const hist = perPlateAt(versionId, o.created_at);
      if (hist) {
        atSaleTime += 1;
        if (hist.gradeFallback) gradeFallbackLines += 1;
        recipeCost += hist.perPlate * Number(it.quantity);
        continue;
      }
      estimated += 1;
      const pp = perPlate.get(versionId);
      if (pp === undefined || Number.isNaN(pp)) {
        warnings.push(`${nameById.get(versionId) ?? "A sold dish"}: its recipe can't be costed (missing unit conversion). Its plates are counted as ₦0 cost.`);
        continue;
      }
      recipeCost += pp * Number(it.quantity);
    }
  }

  if (atSaleTime > 0) {
    warnings.push(`${atSaleTime} older sold item${atSaleTime === 1 ? "" : "s"} had no saved cost, so ${atSaleTime === 1 ? "its" : "their"} cost is estimated from the ingredient prices on the day of the sale.`);
  }
  if (gradeFallbackLines > 0) {
    warnings.push(`${gradeFallbackLines} of those had no price for the chosen grade at the time, so the latest price at that time was used.`);
  }
  if (estimated > 0) {
    warnings.push(`${estimated} older sold item${estimated === 1 ? "" : "s"} had no saved cost and no known ingredient price for the day of the sale, so ${estimated === 1 ? "its" : "their"} cost uses today's ingredient prices.`);
  }
  const recipe_cost_of_goods_kobo = Math.round(recipeCost);
  const wastage_cost_kobo = (wastage.data ?? []).reduce((s, w) => s + Number(w.cost_kobo), 0);
  const cost_of_goods_kobo = recipe_cost_of_goods_kobo + wastage_cost_kobo;

  return {
    gross_sales_kobo,
    recipe_cost_of_goods_kobo,
    wastage_cost_kobo,
    cost_of_goods_kobo,
    gross_margin_kobo: gross_sales_kobo - cost_of_goods_kobo,
    food_cost_percentage: gross_sales_kobo > 0 ? (cost_of_goods_kobo / gross_sales_kobo) * 100 : null,
    paid_orders: (orders.data ?? []).length,
    daily: [...daily.entries()].sort().map(([date, sales_kobo]) => ({ date, sales_kobo })),
    warnings: [...new Set(warnings)],
    limitations: [
      history
        ? "Each sale uses the recipe exactly as it was when sold. Sales with a saved cost use it unchanged; older sales are estimated from the ingredient prices in force at the sale time, or today's prices where no earlier price is known (see warnings)."
        : "Each sale uses the recipe exactly as it was when sold, but older sales without a saved cost use today's ingredient prices, because ingredient price history isn't available here. If prices changed, those sales may show a different cost than they really had.",
    ],
  };
}

// Like-for-like comparison: the SAME one function run over both periods.
// The screen computes the difference from these two results — no second calculation.
export type PeriodComparison = { current: PnlResult; previous: PnlResult };

export async function compareBusinessPnl(
  supabase: SupabaseClient,
  business_id: string,
  current: DateRange,
  previous: DateRange,
): Promise<PeriodComparison> {
  const [cur, prev] = await Promise.all([
    calculateBusinessPnl(supabase, business_id, current),
    calculateBusinessPnl(supabase, business_id, previous),
  ]);
  return { current: cur, previous: prev };
}

// Period helpers in Nigeria time (weeks start Monday 00:00 WAT). weekOffset/monthOffset 0 = current, 1 = previous.
export function weekRange(weekOffset = 0, now = new Date()): DateRange {
  const n = toLagosWallClock(now);
  const day = (n.getUTCDay() + 6) % 7; // Monday = 0
  const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - day - 7 * weekOffset));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from: fromLagosWallClock(from), to: fromLagosWallClock(to) };
}

export function monthRange(monthOffset = 0, now = new Date()): DateRange {
  const n = toLagosWallClock(now);
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth() - monthOffset;
  return {
    from: fromLagosWallClock(new Date(Date.UTC(y, m, 1))),
    to: fromLagosWallClock(new Date(Date.UTC(y, m + 1, 1))),
  };
}
