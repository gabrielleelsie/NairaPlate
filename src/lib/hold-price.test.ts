import { describe, expect, it } from "vitest";
import { driftByCost, suggestMinimums, trimToTarget, type HoldLine } from "./hold-price";
import type { CostIngredient } from "./costing";

// Prices per kg: tomato 1000, rice 800, oil 600 (in kobo: x100).
const ing: CostIngredient[] = [
  { id: "t", name: "Tomato", base_unit: "kg", current_cost_kobo: 100000 },
  { id: "r", name: "Rice", base_unit: "kg", current_cost_kobo: 80000 },
  { id: "o", name: "Oil", base_unit: "kg", current_cost_kobo: 60000 },
];
const line = (key: number, id: string, q: number, min: number | null, never = false): HoldLine => ({ key, ingredient_id: id, quantity: q, unit: "kg", min_quantity: min, never_cut: never });
// Cost per plate (1 plate): tomato 1 kg 1000 + rice 1 kg 800 + oil 0.5 kg 300 = 2100 (₦). Price ₦3,000 -> margin 30%.
const lines = [line(1, "t", 1, 0.85), line(2, "r", 1, 0.85), line(3, "o", 0.5, 0.425)];
const run = (over: Partial<Parameters<typeof trimToTarget>[0]> = {}) =>
  trimToTarget({ lines, ingredients: ing, conversions: [], yield_portions: 1, price_kobo: 300000, target_margin_bps: 3500, grade: null, ...over });

describe("suggestMinimums", () => {
  it("proposes 85% of today's amount, rounded up, skipping never-cut and lines that already have one", () => {
    const m = suggestMinimums([line(1, "t", 1, null), line(2, "r", 0.5, null), line(3, "o", 2, null, true), line(4, "x", 3, 2)]);
    expect(m.get(1)).toBe(0.85);
    expect(m.get(2)).toBe(0.43); // 0.425 rounded up
    expect(m.has(3)).toBe(false);
    expect(m.has(4)).toBe(false);
  });
});

describe("trimToTarget", () => {
  it("trims enough to reach the target margin and reports the true result", () => {
    // Target 35% at ₦3,000 means cost 1950 per plate, so 150 must come off 2100.
    const r = run();
    expect(r.error).toBeNull();
    expect(r.before.cost_per_plate_kobo).toBe(210000);
    expect(Math.round(r.before.margin_pct)).toBe(30);
    expect(r.reached).toBe(true);
    expect(r.after.cost_per_plate_kobo).toBeLessThanOrEqual(195000);
    expect(r.after.margin_pct).toBeGreaterThanOrEqual(35 - 0.01);
    expect(r.proposals.length).toBe(3);
    for (const p of r.proposals) expect(p.to).toBeGreaterThanOrEqual(lines.find((l) => l.key === p.key)!.min_quantity!);
  });
  it("never goes below a minimum, and says how far short it falls", () => {
    // Minimums at 95% can only remove 5% of 2100 = 105, so ₦45 short of the 150 needed.
    const tight = [line(1, "t", 1, 0.95), line(2, "r", 1, 0.95), line(3, "o", 0.5, 0.475)];
    const r = run({ lines: tight });
    expect(r.reached).toBe(false);
    expect(r.proposals.every((p) => p.to >= tight.find((l) => l.key === p.key)!.min_quantity!)).toBe(true);
    expect(r.shortfall_per_plate_kobo).toBeGreaterThan(3000);
    expect(r.shortfall_per_plate_kobo).toBeLessThan(5000);
  });
  it("leaves never-cut lines and lines with no minimum alone", () => {
    const r = run({ lines: [line(1, "t", 1, 0.5, true), line(2, "r", 1, null), line(3, "o", 0.5, 0.4)] });
    expect(r.proposals.map((p) => p.key)).toEqual([3]);
    expect(r.reached).toBe(false);
  });
  it("lets the other lines take the slack when one hits its minimum", () => {
    const r = run({ lines: [line(1, "t", 1, 0.99), line(2, "r", 1, 0.5), line(3, "o", 0.5, 0.25)] });
    expect(r.reached).toBe(true);
    expect(r.proposals.find((p) => p.key === 1)!.to).toBeGreaterThanOrEqual(0.99);
  });
  it("does nothing when the dish is already on target", () => {
    const r = run({ price_kobo: 400000 });
    expect(r.reached).toBe(true);
    expect(r.proposals).toEqual([]);
  });
  it("gives an error instead of a number when a line cannot be costed", () => {
    const r = run({ lines: [{ ...line(1, "t", 1, 0.85), unit: "bag" }] });
    expect(r.error).toMatch(/No conversion/);
    expect(r.proposals).toEqual([]);
  });
});

describe("driftByCost", () => {
  const items = (q: number) => [{ ingredient_id: "t", quantity: q, unit: "kg" }];
  it("shows lighter as negative", () => {
    const d = driftByCost({ original: { items: items(1), yield_portions: 1 }, current: { items: items(0.88), yield_portions: 1 }, ingredients: ing, conversions: [], grade: null });
    expect(Math.round(d!)).toBe(-12);
  });
  it("is null with no first recipe or a line that cannot be costed", () => {
    expect(driftByCost({ original: null, current: { items: items(1), yield_portions: 1 }, ingredients: ing, conversions: [], grade: null })).toBeNull();
    expect(driftByCost({ original: { items: [{ ingredient_id: "t", quantity: 1, unit: "bag" }], yield_portions: 1 }, current: { items: items(1), yield_portions: 1 }, ingredients: ing, conversions: [], grade: null })).toBeNull();
  });
});
