// "Hold my price": when a dish has slipped under its target margin, work out how to bring the cost back
// down by trimming ingredient quantities, without ever going below the owner's minimums.
// Pure functions. The cost of every result comes from computeRecipeCost(), the one shared costing function.
import { computeRecipeCost, type CostConversion, type CostIngredient, type CostRecipeItem } from "@/lib/costing";

export const SUGGESTED_MINIMUM_SHARE = 0.85; // "suggest minimums" proposes 85% of today's amount; the owner edits any of them

export type HoldLine = {
  key: number; ingredient_id: string; quantity: number; unit: string;
  min_quantity: number | null; // never cut below this. Empty (null) means this line is not cut.
  never_cut: boolean;
};

export type Proposal = { key: number; ingredient_id: string; from: number; to: number; unit: string };
export type TrimResult = {
  proposals: Proposal[]; // only lines that change
  before: { cost_per_plate_kobo: number; margin_pct: number };
  after: { cost_per_plate_kobo: number; margin_pct: number };
  target_pct: number; reached: boolean;
  shortfall_per_plate_kobo: number; // 0 when the target is reached
  error: string | null;
};

const round2Down = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const round2Up = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/** 85% (by default) of today's amount for every line that is not marked never-cut. Existing minimums are kept. */
export function suggestMinimums(lines: HoldLine[], share = SUGGESTED_MINIMUM_SHARE): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of lines) {
    if (l.never_cut || l.min_quantity !== null || !(l.quantity > 0)) continue;
    out.set(l.key, Math.min(l.quantity, round2Up(l.quantity * share)));
  }
  return out;
}

export function trimToTarget(input: {
  lines: HoldLine[]; ingredients: CostIngredient[]; conversions: CostConversion[];
  yield_portions: number; price_kobo: number; target_margin_bps: number; grade: string | null;
}): TrimResult {
  const { lines, ingredients, conversions, yield_portions, price_kobo, target_margin_bps, grade } = input;
  const target_pct = target_margin_bps / 100;
  const asItems = (ls: { ingredient_id: string; quantity: number; unit: string }[]): CostRecipeItem[] =>
    ls.map((l) => ({ ingredient_id: l.ingredient_id, quantity: l.quantity, unit: l.unit }));
  const cost = (ls: { ingredient_id: string; quantity: number; unit: string }[]) =>
    computeRecipeCost({ items: asItems(ls), ingredients, conversions, yield_portions, target_margin_bps: 0, grade });
  const summary = (c: ReturnType<typeof cost>) => ({
    cost_per_plate_kobo: c.cost_per_plate_kobo,
    margin_pct: price_kobo > 0 ? (1 - c.total_ingredient_cost_kobo / yield_portions / price_kobo) * 100 : 0,
  });

  const base = cost(lines);
  const blank = { proposals: [], before: summary(base), after: summary(base), target_pct, reached: false, shortfall_per_plate_kobo: 0 };
  if (base.errors.length || !(price_kobo > 0) || !(yield_portions > 0)) return { ...blank, error: base.errors[0] ?? "Check the price and plates the dish makes." };

  const allowedTotal = price_kobo * (1 - target_pct / 100) * yield_portions;
  let remaining = base.total_ingredient_cost_kobo - allowedTotal;
  if (remaining <= 0) return { ...blank, reached: true, error: null };

  // Cuttable lines and the most each one can give: its cost times the share between the minimum and today's amount.
  const cap = new Map<number, number>(), lineCost = new Map<number, number>();
  base.lines.forEach((bl, i) => {
    const l = lines[i]!;
    const c = bl.line_cost_kobo ?? 0;
    if (l.never_cut || l.min_quantity === null || !(l.quantity > 0) || l.min_quantity >= l.quantity || c <= 0) return;
    lineCost.set(l.key, c);
    cap.set(l.key, c * (1 - l.min_quantity / l.quantity));
  });

  // Spread the cut in proportion to cost. A line that hits its minimum is capped and the rest takes the slack.
  const cut = new Map<number, number>();
  let active = new Set(cap.keys());
  while (remaining > 1e-6 && active.size > 0) {
    const sum = [...active].reduce((s, k) => s + lineCost.get(k)!, 0);
    const capped = [...active].filter((k) => (remaining * lineCost.get(k)!) / sum >= cap.get(k)! - (cut.get(k) ?? 0));
    if (capped.length === 0) {
      for (const k of active) cut.set(k, (cut.get(k) ?? 0) + (remaining * lineCost.get(k)!) / sum);
      remaining = 0;
      break;
    }
    for (const k of capped) {
      const room = cap.get(k)! - (cut.get(k) ?? 0);
      cut.set(k, (cut.get(k) ?? 0) + room);
      remaining -= room;
      active.delete(k);
    }
    active = new Set(active);
  }

  const proposals: Proposal[] = [];
  const next = lines.map((l) => {
    const c = cut.get(l.key);
    if (!c) return l;
    const f = c / lineCost.get(l.key)!;
    const to = Math.max(l.min_quantity!, round2Down(l.quantity * (1 - f)));
    if (to < l.quantity) proposals.push({ key: l.key, ingredient_id: l.ingredient_id, from: l.quantity, to, unit: l.unit });
    return { ...l, quantity: Math.min(l.quantity, to) };
  });
  const after = cost(next);
  const afterSummary = summary(after);
  const target_cost_per_plate = price_kobo * (1 - target_pct / 100);
  const shortfall = Math.max(0, after.total_ingredient_cost_kobo / yield_portions - target_cost_per_plate);
  return {
    proposals, before: summary(base), after: afterSummary, target_pct,
    reached: shortfall < 1, shortfall_per_plate_kobo: shortfall < 1 ? 0 : Math.round(shortfall), error: null,
  };
}

/**
 * How much lighter (negative) or heavier the dish is than its first recipe, measured by ingredient cost per plate at
 * today's prices and the same grade. Comparing by cost keeps it meaningful when units or ingredients were changed.
 */
export function driftByCost(input: {
  original: { items: CostRecipeItem[]; yield_portions: number } | null;
  current: { items: CostRecipeItem[]; yield_portions: number };
  ingredients: CostIngredient[]; conversions: CostConversion[]; grade: string | null;
}): number | null {
  const { original, current, ingredients, conversions, grade } = input;
  if (!original || original.items.length === 0) return null;
  const c = (x: { items: CostRecipeItem[]; yield_portions: number }) =>
    computeRecipeCost({ items: x.items, ingredients, conversions, yield_portions: x.yield_portions, target_margin_bps: 0, grade });
  const a = c(original), b = c(current);
  if (a.errors.length || b.errors.length) return null;
  const pa = a.total_ingredient_cost_kobo / original.yield_portions;
  const pb = b.total_ingredient_cost_kobo / current.yield_portions;
  if (!(pa > 0)) return null;
  return ((pb - pa) / pa) * 100;
}
