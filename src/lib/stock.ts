// Stock control helpers: turning what was counted into the base unit, the difference from what the app expected, and the
// "unexplained loss" summary from the stock record. Pure functions, no database calls.
import { toBaseQty, type CostConversion, type CostIngredient } from "@/lib/costing";

export type StockMode = "made_to_order" | "batch";
export const STOCK_MODE_LABEL: Record<StockMode, string> = { made_to_order: "Made to order", batch: "Cooked in batches" };
export const STOCK_MODE_HELP: Record<StockMode, string> = {
  made_to_order: "Stock goes down when a plate is sold, using this dish's recipe.",
  batch: "Stock goes down when you log a batch. Selling a plate does not change stock.",
};

export const REASON_LABEL: Record<string, string> = {
  purchase: "Bought", purchase_reversed: "Purchase reversed", batch_use: "Used in a batch", batch_reversed: "Batch reversed, put back", sale_use: "Used in a sale", sale_void: "Sale voided, put back",
  wastage: "Wastage", wastage_removed: "Wastage entry removed", count_correction: "Stock-take correction",
  opening_count: "Opening count", opening_balance: "Starting figure", unlabelled: "Changed by hand",
};
export const reasonLabel = (r: string) => REASON_LABEL[r] ?? r.replaceAll("_", " ");

/** What was counted, in the ingredient's base unit. null when the unit cannot be converted. */
export function countedToBase(ing: CostIngredient, qty: number, unit: string, conversions: CostConversion[]): number | null {
  if (!(qty >= 0) || !unit) return null;
  return toBaseQty(ing, qty, unit, conversions).base_qty;
}

export type Variance = { diff_base: number; value_kobo: number; matches: boolean };
/** counted minus expected, in base units and in naira at today's price. Differences under 0.001 count as a match. */
export function variance(expected_base: number, counted_base: number, price_kobo: number): Variance {
  const diff = Math.round((counted_base - expected_base) * 10000) / 10000;
  const matches = Math.abs(diff) < 0.001;
  return { diff_base: matches ? 0 : diff, value_kobo: matches ? 0 : Math.round(diff * price_kobo), matches };
}

export type Movement = { ingredient_id: string; qty_base: number; reason: string; created_at: string };
export type LossRow = { ingredient_id: string; name: string; base_unit: string; lost_base: number; value_kobo: number; by_hand_base: number };
export type LossSummary = { rows: LossRow[]; unexplained_kobo: number; by_hand_count: number; wastage_kobo: number };

/**
 * Unexplained loss from the stock record: what stock-takes found missing (negative corrections) plus anything changed by hand.
 * The opening count is a starting point, not a loss, so it is left out. Wastage that was logged is explained, so it is shown
 * separately. Valued at today's price per base unit.
 */
export function summarizeLosses(movements: Movement[], ingredients: { id: string; name: string; base_unit: string; current_cost_kobo: number }[]): LossSummary {
  const byIng = new Map<string, LossRow>();
  let wastage = 0, byHandCount = 0;
  const ingOf = new Map(ingredients.map((i) => [i.id, i]));
  for (const m of movements) {
    const ing = ingOf.get(m.ingredient_id);
    if (!ing) continue;
    const q = Number(m.qty_base);
    if (m.reason === "wastage") { wastage += Math.round(-q * ing.current_cost_kobo); continue; }
    if (m.reason === "wastage_removed") { wastage -= Math.round(q * ing.current_cost_kobo); continue; }
    const isCount = m.reason === "count_correction";
    const isHand = m.reason === "unlabelled";
    if (!isCount && !isHand) continue;
    const row = byIng.get(ing.id) ?? { ingredient_id: ing.id, name: ing.name, base_unit: ing.base_unit, lost_base: 0, value_kobo: 0, by_hand_base: 0 };
    if (isCount) row.lost_base += -q; // positive = missing
    else { row.by_hand_base += q; byHandCount++; }
    byIng.set(ing.id, row);
  }
  const rows = [...byIng.values()].map((r) => ({ ...r, lost_base: Math.round(r.lost_base * 1000) / 1000, value_kobo: Math.round(r.lost_base * (ingOf.get(r.ingredient_id)?.current_cost_kobo ?? 0)) }))
    .filter((r) => Math.abs(r.lost_base) >= 0.001 || Math.abs(r.by_hand_base) >= 0.001)
    .sort((a, b) => b.value_kobo - a.value_kobo);
  return { rows, unexplained_kobo: rows.reduce((s, r) => s + r.value_kobo, 0), by_hand_count: byHandCount, wastage_kobo: Math.max(0, wastage) };
}
