// NairaPlate P&L — the ONE place gross sales, cost of goods, gross margin and food cost % are calculated.
// Every screen that shows any of these numbers must call calculateBusinessPnl().
//
// KNOWN LIMITATION: recipes are not versioned yet. Cost of goods for each sold plate uses the
// recipe's cost per plate AS IT STANDS TODAY (today's ingredient prices and today's recipe
// ingredients), not the cost on the day of the sale. If ingredient prices rise, past sales will
// show a higher cost of goods than they really had. The result carries this in `limitations`.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRecipeCost, type CostConversion, type CostIngredient, type CostRecipeItem } from "@/lib/costing";

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

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function calculateBusinessPnl(
  supabase: SupabaseClient,
  business_id: string,
  date_range: DateRange,
): Promise<PnlResult> {
  const from = date_range.from.toISOString();
  const to = date_range.to.toISOString();

  const [orders, wastage, ingredients, conversions, recipes, recipeItems, partials] = await Promise.all([
    // Only 'paid' and 'partially_refunded' orders count. 'cancelled' (void) and 'refunded' count as ₦0.
    supabase.from("orders")
      .select("id,total_kobo,created_at,order_items(recipe_id,quantity)")
      .eq("business_id", business_id).in("status", ["paid", "partially_refunded"])
      .gte("created_at", from).lt("created_at", to),
    supabase.from("wastage_logs").select("cost_kobo")
      .eq("business_id", business_id).gte("created_at", from).lt("created_at", to),
    supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").eq("business_id", business_id),
    supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty").eq("business_id", business_id),
    supabase.from("recipes").select("id,name,yield_portions").eq("business_id", business_id),
    supabase.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").eq("business_id", business_id),
    // Partial refunds per order. If the refunds table isn't set up yet, treat as no refunds.
    supabase.from("order_adjustments").select("order_id,adjustment_amount_kobo")
      .eq("business_id", business_id).eq("type", "partial_refund"),
  ]);
  const failed = [orders, wastage, ingredients, conversions, recipes, recipeItems].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const refundedByOrder = new Map<string, number>();
  for (const a of partials.error ? [] : partials.data ?? []) {
    refundedByOrder.set(a.order_id, (refundedByOrder.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo));
  }

  const ings: CostIngredient[] = (ingredients.data ?? []).map((i) => ({ ...i, current_cost_kobo: Number(i.current_cost_kobo) }));
  const convs: CostConversion[] = (conversions.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) }));
  const items = (recipeItems.data ?? []) as (CostRecipeItem & { recipe_id: string })[];
  const warnings: string[] = [];

  // Today's exact (unrounded) cost per plate for each recipe, via the shared costing function.
  const perPlate = new Map<string, number>();
  for (const r of recipes.data ?? []) {
    const c = computeRecipeCost({
      items: items.filter((i) => i.recipe_id === r.id).map((i) => ({ ...i, quantity: Number(i.quantity) })),
      ingredients: ings, conversions: convs, yield_portions: Number(r.yield_portions), target_margin_bps: 0,
    });
    if (c.errors.length) warnings.push(`${r.name}: ${c.errors[0]} Its plates are counted as ₦0 cost.`);
    else perPlate.set(r.id, c.total_ingredient_cost_kobo / Number(r.yield_portions));
  }

  // Daily buckets across the whole range, so days with no sales show as 0 on the chart.
  const daily = new Map<string, number>();
  for (let d = new Date(date_range.from); d < date_range.to; d.setUTCDate(d.getUTCDate() + 1)) daily.set(dayKey(d), 0);

  let gross_sales_kobo = 0;
  let recipeCost = 0;
  for (const o of orders.data ?? []) {
    // Net sale = total minus every partial refund on that order.
    const total = Number(o.total_kobo) - (refundedByOrder.get(o.id) ?? 0);
    gross_sales_kobo += total;
    const k = dayKey(new Date(o.created_at));
    daily.set(k, (daily.get(k) ?? 0) + total);
    for (const it of (o.order_items ?? []) as { recipe_id: string; quantity: number }[]) {
      recipeCost += (perPlate.get(it.recipe_id) ?? 0) * Number(it.quantity);
    }
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
      "Plate costs use today's recipes and ingredient prices, because recipe history isn't saved yet. Past sales may show a different cost than they really had.",
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

// Period helpers (UTC). weekOffset/monthOffset 0 = current, 1 = previous.
export function weekRange(weekOffset = 0, now = new Date()): DateRange {
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day - 7 * weekOffset));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from, to };
}

export function monthRange(monthOffset = 0, now = new Date()): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - monthOffset;
  return {
    from: new Date(Date.UTC(y, m, 1)),
    to: new Date(Date.UTC(y, m + 1, 1)),
  };
}
