// "Today's cost check": what changed in the kitchen's costs, what it is costing, and how yesterday went.
// computeCostCheck() is a pure function (easy to test). loadCostCheck() fetches the rows and calls it, and works
// with the browser client (owner screen) or the service client (daily email), the same way calculateBusinessPnl does.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRecipeCost, type CostConversion, type CostIngredient, type CostRecipeItem } from "@/lib/costing";
import { DAY_MS, LAGOS_OFFSET_MS, lagosDateKey, lagosDayStart } from "@/lib/lagos-time";

export const MARGIN_GAP_POINTS = 3; // a dish is flagged when its margin is this many points under the target
export const STALE_DAYS = 14; // an ingredient price older than this is flagged
export const MAX_ITEMS = 5;

export type RecipeRow = {
  id: string; name: string; yield_portions: number; selling_price_kobo: number;
  cost_grade: string | null; is_current: boolean;
};
export type IngredientRow = CostIngredient & { price_updated_at: string | null; current_season: string | null };
export type OrderLine = { recipe_id: string; recipe_version_id: string | null; quantity: number; unit_price_kobo: number; cost_per_plate_kobo: number | string | null };
export type OrderRow = { id: string; created_at: string; order_items: OrderLine[] | null };

export type DishSales = { name: string; plates: number; sales_kobo: number; cost_kobo: number; profit_kobo: number };
export type DayStats = {
  date_key: string; label: string; orders: number; plates: number; sales_kobo: number; profit_kobo: number; dishes: DishSales[];
};
export type DishOption = { grade: string; cost_per_plate_kobo: number; margin_pct: number };
export type AttentionDish = {
  recipe_id: string; name: string; grade: string | null; price_kobo: number; cost_per_plate_kobo: number;
  margin_pct: number; target_pct: number; suggested_price_kobo: number | null;
  week_plates: number; week_loss_kobo: number | null; options: DishOption[]; fallbacks: string[];
};
export type StaleIngredient = { id: string; name: string; days_old: number | null };
export type ScarceIngredient = { name: string; dishes: number };
export type CostCheck = {
  yesterday: DayStats; last_month: DayStats;
  most_ordered: DishSales | null; most_profitable: DishSales | null;
  attention: AttentionDish[]; attention_total: number;
  stale: StaleIngredient[]; stale_total: number; scarce: ScarceIngredient[];
  estimated_lines: number; // sold lines with no frozen cost (older sales): costed at today's prices
  uncosted_lines: number; // sold lines that could not be costed at all
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The same calendar date one month earlier, kept inside that month (31 Mar becomes 28/29 Feb). */
export function sameDayLastMonth(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const dim = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${pad(pm)}-${pad(Math.min(d, dim))}`;
}

export const dayRange = (dateKey: string) => {
  const from = new Date(Date.parse(`${dateKey}T00:00:00Z`) - LAGOS_OFFSET_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
};

export const dayLabel = (dateKey: string) =>
  new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function plateCosts(recipes: RecipeRow[], items: (CostRecipeItem & { recipe_id: string })[], ingredients: CostIngredient[], conversions: CostConversion[]) {
  const byRecipe = new Map<string, CostRecipeItem[]>();
  for (const i of items) byRecipe.set(i.recipe_id, [...(byRecipe.get(i.recipe_id) ?? []), i]);
  const perPlate = new Map<string, number>(); // exact cost per plate, NaN when it cannot be costed
  for (const r of recipes) {
    const c = computeRecipeCost({
      items: byRecipe.get(r.id) ?? [], ingredients, conversions, yield_portions: Number(r.yield_portions),
      target_margin_bps: 0, grade: r.cost_grade,
    });
    perPlate.set(r.id, c.errors.length || !(byRecipe.get(r.id)?.length) ? NaN : c.total_ingredient_cost_kobo / Number(r.yield_portions));
  }
  return perPlate;
}

function dayStats(
  dateKey: string, orders: OrderRow[], nameOf: Map<string, string>, perPlate: Map<string, number>,
  counters: { estimated: number; uncosted: number },
): DayStats {
  const by = new Map<string, DishSales>();
  let plates = 0, sales = 0, profit = 0, orderCount = 0;
  for (const o of orders) {
    if (lagosDateKey(new Date(o.created_at)) !== dateKey) continue;
    orderCount++;
    for (const it of o.order_items ?? []) {
      const vid = it.recipe_version_id ?? it.recipe_id;
      const name = nameOf.get(vid) ?? nameOf.get(it.recipe_id) ?? "A sold dish";
      const q = Number(it.quantity);
      const lineSales = Number(it.unit_price_kobo) * q;
      let cost: number;
      if (it.cost_per_plate_kobo !== null && it.cost_per_plate_kobo !== undefined) cost = Number(it.cost_per_plate_kobo) * q;
      else {
        counters.estimated++;
        const pp = perPlate.get(vid);
        if (pp === undefined || Number.isNaN(pp)) { counters.uncosted++; cost = 0; } else cost = pp * q;
      }
      const d = by.get(name) ?? { name, plates: 0, sales_kobo: 0, cost_kobo: 0, profit_kobo: 0 };
      d.plates += q; d.sales_kobo += lineSales; d.cost_kobo += cost; d.profit_kobo += lineSales - cost;
      by.set(name, d);
      plates += q; sales += lineSales; profit += lineSales - cost;
    }
  }
  const dishes = [...by.values()].map((d) => ({ ...d, cost_kobo: Math.round(d.cost_kobo), profit_kobo: Math.round(d.profit_kobo), sales_kobo: Math.round(d.sales_kobo) }));
  return { date_key: dateKey, label: dayLabel(dateKey), orders: orderCount, plates, sales_kobo: Math.round(sales), profit_kobo: Math.round(profit), dishes };
}

export function computeCostCheck(input: {
  now: Date; target_margin_bps: number;
  recipes: RecipeRow[]; items: (CostRecipeItem & { recipe_id: string })[];
  ingredients: IngredientRow[]; conversions: CostConversion[];
  week_orders: OrderRow[]; last_month_orders: OrderRow[];
}): CostCheck {
  const { now, recipes, items, ingredients, conversions } = input;
  const targetPct = input.target_margin_bps / 100;
  const nameOf = new Map(recipes.map((r) => [r.id, r.name]));
  const perPlate = plateCosts(recipes, items, ingredients, conversions);
  const counters = { estimated: 0, uncosted: 0 };

  const yesterdayKey = lagosDateKey(new Date(lagosDayStart(now).getTime() - 1));
  const lastMonthKey = sameDayLastMonth(yesterdayKey);
  const yesterday = dayStats(yesterdayKey, input.week_orders, nameOf, perPlate, counters);
  const last_month = dayStats(lastMonthKey, input.last_month_orders, nameOf, perPlate, { estimated: 0, uncosted: 0 });
  const most_ordered = [...yesterday.dishes].sort((a, b) => b.plates - a.plates || b.profit_kobo - a.profit_kobo)[0] ?? null;
  const most_profitable = [...yesterday.dishes].sort((a, b) => b.profit_kobo - a.profit_kobo)[0] ?? null;

  // Plates sold per dish name over the last 7 days (the week ending yesterday), for the "costing you about" estimate.
  const weekPlates = new Map<string, number>();
  for (const o of input.week_orders) for (const it of o.order_items ?? []) {
    const n = nameOf.get(it.recipe_version_id ?? it.recipe_id) ?? nameOf.get(it.recipe_id);
    if (n) weekPlates.set(n, (weekPlates.get(n) ?? 0) + Number(it.quantity));
  }

  // Dishes under target margin, costed at each dish's own grade.
  const current = recipes.filter((r) => r.is_current);
  const attentionAll: AttentionDish[] = [];
  for (const r of current) {
    const rItems = items.filter((i) => i.recipe_id === r.id);
    if (rItems.length === 0 || !(r.selling_price_kobo > 0)) continue;
    const c = computeRecipeCost({ items: rItems, ingredients, conversions, yield_portions: Number(r.yield_portions), target_margin_bps: input.target_margin_bps, grade: r.cost_grade });
    if (c.errors.length) continue;
    const margin = (1 - c.total_ingredient_cost_kobo / Number(r.yield_portions) / r.selling_price_kobo) * 100;
    if (margin > targetPct - MARGIN_GAP_POINTS) continue;
    const plates = weekPlates.get(r.name) ?? 0;
    const gap = c.suggested_price_kobo !== null ? c.suggested_price_kobo - r.selling_price_kobo : null;
    const options: DishOption[] = [];
    for (const g of ["A", "B", "C"]) {
      if (g === r.cost_grade) continue;
      const o = computeRecipeCost({ items: rItems, ingredients, conversions, yield_portions: Number(r.yield_portions), target_margin_bps: 0, grade: g });
      if (o.errors.length || o.fallbacks.length === new Set(rItems.map((i) => i.ingredient_id)).size) continue; // no price at that grade at all
      const pp = o.total_ingredient_cost_kobo / Number(r.yield_portions);
      if (pp < c.total_ingredient_cost_kobo / Number(r.yield_portions)) options.push({ grade: g, cost_per_plate_kobo: Math.round(pp), margin_pct: (1 - pp / r.selling_price_kobo) * 100 });
    }
    attentionAll.push({
      recipe_id: r.id, name: r.name, grade: r.cost_grade, price_kobo: r.selling_price_kobo, cost_per_plate_kobo: c.cost_per_plate_kobo,
      margin_pct: margin, target_pct: targetPct, suggested_price_kobo: c.suggested_price_kobo,
      week_plates: plates, week_loss_kobo: gap !== null && gap > 0 && plates > 0 ? Math.round(gap * plates) : null,
      options, fallbacks: c.fallbacks,
    });
  }
  attentionAll.sort((a, b) => (b.week_loss_kobo ?? 0) - (a.week_loss_kobo ?? 0) || a.margin_pct - b.margin_pct);

  const stale_ = staleIngredients(ingredients, new Set(items.filter((i) => current.some((r) => r.id === i.recipe_id)).map((i) => i.ingredient_id)), now);

  // Ingredients whose last purchase was marked Scarce, and how many current dishes use them.
  const scarce: ScarceIngredient[] = [];
  for (const ing of ingredients) {
    if (ing.current_season !== "scarce") continue;
    const dishes = new Set(items.filter((i) => i.ingredient_id === ing.id && current.some((r) => r.id === i.recipe_id)).map((i) => i.recipe_id)).size;
    if (dishes > 0) scarce.push({ name: ing.name, dishes });
  }
  scarce.sort((a, b) => b.dishes - a.dishes);

  return {
    yesterday, last_month, most_ordered, most_profitable,
    attention: attentionAll.slice(0, MAX_ITEMS), attention_total: attentionAll.length,
    stale: stale_.slice(0, MAX_ITEMS), stale_total: stale_.length, scarce: scarce.slice(0, MAX_ITEMS),
    estimated_lines: counters.estimated, uncosted_lines: counters.uncosted,
  };
}

/** Ingredients (limited to `usedIds` when given) whose price has not been updated for STALE_DAYS or more, oldest first. */
export function staleIngredients(ingredients: { id: string; name: string; price_updated_at: string | null }[], usedIds: Set<string> | null, now: Date): StaleIngredient[] {
  const out: StaleIngredient[] = [];
  for (const ing of ingredients) {
    if (usedIds && !usedIds.has(ing.id)) continue;
    const t = ing.price_updated_at ? Date.parse(ing.price_updated_at) : NaN;
    const days = Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY_MS);
    if (days === null || days >= STALE_DAYS) out.push({ id: ing.id, name: ing.name, days_old: days });
  }
  return out.sort((a, b) => (b.days_old ?? 1e9) - (a.days_old ?? 1e9));
}

/** Fetches everything and runs computeCostCheck. `staleOnly` is for roles that may not read recipes or sales. */
export async function loadCostCheck(supabase: SupabaseClient, business_id: string, now = new Date()): Promise<CostCheck> {
  const yKey = lagosDateKey(new Date(lagosDayStart(now).getTime() - 1));
  const todayStart = lagosDayStart(now);
  const weekFrom = new Date(todayStart.getTime() - 7 * DAY_MS);
  const lm = dayRange(sameDayLastMonth(yKey));
  const ordersQ = (from: Date, to: Date) => supabase.from("orders")
    .select("id,created_at,order_items(recipe_id,recipe_version_id,quantity,unit_price_kobo,cost_per_plate_kobo)")
    .eq("business_id", business_id).in("status", ["paid", "partially_refunded"])
    .gte("created_at", from.toISOString()).lt("created_at", to.toISOString());

  const [recipes, items, ings, convs, gp, biz, week, lastMonth] = await Promise.all([
    supabase.from("recipes").select("id,name,yield_portions,selling_price_kobo,cost_grade,is_current").eq("business_id", business_id),
    supabase.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").eq("business_id", business_id),
    supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo,price_updated_at,current_season").eq("business_id", business_id),
    supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty").eq("business_id", business_id),
    supabase.from("ingredient_grade_prices").select("ingredient_id,grade,cost_kobo").eq("business_id", business_id),
    supabase.from("businesses").select("target_margin_bps").eq("id", business_id).maybeSingle(),
    ordersQ(weekFrom, todayStart),
    ordersQ(lm.from, lm.to),
  ]);
  const failed = [recipes, items, ings, convs, biz, week, lastMonth].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const gradeByIng = new Map<string, Record<string, number>>();
  for (const g of gp.error ? [] : gp.data ?? []) gradeByIng.set(g.ingredient_id, { ...(gradeByIng.get(g.ingredient_id) ?? {}), [g.grade]: Number(g.cost_kobo) });

  return computeCostCheck({
    now, target_margin_bps: Number(biz.data?.target_margin_bps ?? 3500),
    recipes: (recipes.data ?? []).map((r) => ({ ...r, yield_portions: Number(r.yield_portions), selling_price_kobo: Number(r.selling_price_kobo) })) as RecipeRow[],
    items: (items.data ?? []).map((i) => ({ ...i, quantity: Number(i.quantity) })) as (CostRecipeItem & { recipe_id: string })[],
    ingredients: (ings.data ?? []).map((i) => ({ ...i, current_cost_kobo: Number(i.current_cost_kobo), grade_prices: gradeByIng.get(i.id) })) as IngredientRow[],
    conversions: (convs.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) })),
    week_orders: (week.data ?? []) as unknown as OrderRow[],
    last_month_orders: (lastMonth.data ?? []) as unknown as OrderRow[],
  });
}

/** For roles that can read ingredients but not recipes or sales (the purchaser): just the old-price list. */
export async function loadStalePrices(supabase: SupabaseClient, business_id: string, now = new Date()): Promise<{ stale: StaleIngredient[]; total: number }> {
  const { data, error } = await supabase.from("ingredients").select("id,name,price_updated_at").eq("business_id", business_id);
  if (error) throw new Error(error.message);
  const all = staleIngredients(data ?? [], null, now);
  return { stale: all.slice(0, MAX_ITEMS), total: all.length };
}
