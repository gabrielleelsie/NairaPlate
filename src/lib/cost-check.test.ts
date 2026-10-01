import { describe, expect, it } from "vitest";
import { computeCostCheck, dayRange, roundUpToStep, sameDayLastMonth, staleIngredients, type IngredientRow, type OrderRow, type RecipeRow } from "./cost-check";

const now = new Date("2026-10-01T08:00:00Z"); // 09:00 in Lagos on 1 Oct, so "yesterday" is 30 Sep

describe("price step", () => {
  it("rounds up to the next ₦50", () => {
    expect(roundUpToStep(423729)).toBe(425000);
    expect(roundUpToStep(425000)).toBe(425000);
    expect(roundUpToStep(425001)).toBe(430000);
  });
});

describe("dates", () => {
  it("finds the same date last month, inside that month", () => {
    expect(sameDayLastMonth("2026-09-30")).toBe("2026-08-30");
    expect(sameDayLastMonth("2026-03-31")).toBe("2026-02-28");
    expect(sameDayLastMonth("2028-03-31")).toBe("2028-02-29");
    expect(sameDayLastMonth("2026-01-15")).toBe("2025-12-15");
  });
  it("a Lagos day starts at 23:00 UTC the day before", () => {
    expect(dayRange("2026-09-30").from.toISOString()).toBe("2026-09-29T23:00:00.000Z");
  });
});

const tomato: IngredientRow = { id: "t", name: "Tomato", base_unit: "kg", current_cost_kobo: 150000, grade_prices: { A: 150000, B: 90000 }, price_updated_at: "2026-09-29T10:00:00Z", current_season: "scarce" };
const rice: IngredientRow = { id: "r", name: "Rice", base_unit: "kg", current_cost_kobo: 100000, price_updated_at: "2026-09-01T10:00:00Z", current_season: "normal" };
const unused: IngredientRow = { id: "u", name: "Unused", base_unit: "kg", current_cost_kobo: 1, price_updated_at: null, current_season: null };
const recipes: RecipeRow[] = [
  { id: "j", name: "Jollof", yield_portions: 1, selling_price_kobo: 400000, cost_grade: "A", is_current: true },
  { id: "s", name: "Salad", yield_portions: 1, selling_price_kobo: 300000, cost_grade: null, is_current: true },
];
// Jollof: 1 kg tomato + 1 kg rice = 150000 + 100000 = 250000 cost -> margin 37.5% at 400000. Salad: 1 kg rice = 100000 cost -> 66.7%.
const items = [
  { recipe_id: "j", ingredient_id: "t", quantity: 1, unit: "kg" }, { recipe_id: "j", ingredient_id: "r", quantity: 1, unit: "kg" },
  { recipe_id: "s", ingredient_id: "r", quantity: 1, unit: "kg" },
];
const order = (id: string, at: string, lines: [string, number, number, number | null][]): OrderRow => ({
  id, created_at: at,
  order_items: lines.map(([rid, q, price, cost]) => ({ recipe_id: rid, recipe_version_id: rid, quantity: q, unit_price_kobo: price, cost_per_plate_kobo: cost })),
});
const base = { now, recipes, items, ingredients: [tomato, rice, unused], conversions: [] };

describe("computeCostCheck", () => {
  it("flags a dish 3+ points under target, with a what-if at another grade and a weekly estimate", () => {
    const week = [order("1", "2026-09-30T10:00:00Z", [["j", 10, 400000, 250000]])];
    const c = computeCostCheck({ ...base, target_margin_bps: 4100, week_orders: week, last_month_orders: [] });
    expect(c.attention).toHaveLength(1);
    const d = c.attention[0]!;
    expect(d.name).toBe("Jollof");
    expect(d.cost_per_plate_kobo).toBe(250000);
    expect(Math.round(d.margin_pct * 10) / 10).toBe(37.5);
    expect(d.suggested_price_kobo).toBe(423729); // 250000 / (1 - 0.41), rounded up
    expect(d.week_plates).toBe(10);
    expect(d.week_loss_kobo).toBe((423729 - 400000) * 10);
    // Hold the price: cost must fall to 400000 * (1 - 0.41) = 236000, so 14000 off the 250000.
    expect(d.cost_to_cut_kobo).toBe(14000);
    expect(d.round_price_kobo).toBe(425000); // 423729 rounded up to the next ₦50
    expect(Math.round((d.round_price_margin_pct ?? 0) * 10) / 10).toBe(41.2);
    expect(d.options.map((o) => o.grade)).toEqual(["B"]); // B: 90000 + 100000 = 190000, cheaper
    expect(d.options[0]!.cost_per_plate_kobo).toBe(190000);
  });
  it("does not flag a dish within 3 points of target", () => {
    const c = computeCostCheck({ ...base, target_margin_bps: 4100, week_orders: [], last_month_orders: [] });
    expect(c.attention.map((a) => a.name)).toEqual(["Jollof"]); // 37.5 is 3.5 points under 41
    const c2 = computeCostCheck({ ...base, target_margin_bps: 4000, week_orders: [], last_month_orders: [] });
    expect(c2.attention).toHaveLength(0); // 37.5 is only 2.5 points under 40
  });
  it("lists old prices only for ingredients used in dishes, and scarce ones", () => {
    const c = computeCostCheck({ ...base, target_margin_bps: 3500, week_orders: [], last_month_orders: [] });
    expect(c.stale.map((s) => s.name)).toEqual(["Rice"]); // 30 days old; Unused is not in any dish; Tomato is 2 days old
    expect(c.scarce).toEqual([{ name: "Tomato", dishes: 1 }]);
  });
  it("finds yesterday's most ordered and most profitable dish and compares with the same date last month", () => {
    const week = [
      order("1", "2026-09-30T09:00:00Z", [["j", 3, 400000, 250000], ["s", 5, 300000, 100000]]),
      order("2", "2026-09-29T09:00:00Z", [["s", 50, 300000, 100000]]), // the day before: must not count
    ];
    const lm = [order("3", "2026-08-30T09:00:00Z", [["j", 2, 400000, 250000]]), order("4", "2026-08-29T09:00:00Z", [["j", 9, 400000, 250000]])];
    const c = computeCostCheck({ ...base, target_margin_bps: 3500, week_orders: week, last_month_orders: lm });
    expect(c.yesterday.date_key).toBe("2026-09-30");
    expect(c.yesterday.orders).toBe(1);
    expect(c.yesterday.plates).toBe(8);
    expect(c.yesterday.sales_kobo).toBe(3 * 400000 + 5 * 300000);
    expect(c.yesterday.profit_kobo).toBe(3 * 150000 + 5 * 200000);
    expect(c.most_ordered?.name).toBe("Salad"); // 5 plates vs 3
    expect(c.most_profitable?.name).toBe("Salad"); // 1,000,000 vs 450,000
    expect(c.last_month.date_key).toBe("2026-08-30");
    expect(c.last_month.orders).toBe(1);
    expect(c.last_month.sales_kobo).toBe(800000);
  });
  it("uses the frozen cost when there is one, and counts older lines that had to be estimated", () => {
    const week = [order("1", "2026-09-30T09:00:00Z", [["j", 1, 400000, 1000], ["s", 1, 300000, null]])];
    const c = computeCostCheck({ ...base, target_margin_bps: 3500, week_orders: week, last_month_orders: [] });
    expect(c.yesterday.dishes.find((d) => d.name === "Jollof")!.cost_kobo).toBe(1000);
    expect(c.yesterday.dishes.find((d) => d.name === "Salad")!.cost_kobo).toBe(100000); // estimated at today's price
    expect(c.estimated_lines).toBe(1);
  });
  it("handles a day with no sales", () => {
    const c = computeCostCheck({ ...base, target_margin_bps: 3500, week_orders: [], last_month_orders: [] });
    expect(c.most_ordered).toBeNull();
    expect(c.yesterday.orders).toBe(0);
  });
});

describe("staleIngredients", () => {
  it("counts an ingredient with no price date as old", () => {
    expect(staleIngredients([{ id: "a", name: "A", price_updated_at: null }], null, now)).toEqual([{ id: "a", name: "A", days_old: null }]);
  });
  it("uses 14 days as the line", () => {
    const d = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();
    const r = staleIngredients([{ id: "a", name: "A", price_updated_at: d(13) }, { id: "b", name: "B", price_updated_at: d(14) }], null, now);
    expect(r.map((x) => x.name)).toEqual(["B"]);
  });
});
