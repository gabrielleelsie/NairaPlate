import { describe, expect, it } from "vitest";
import { countedToBase, reasonLabel, summarizeLosses, variance } from "./stock";
import type { CostIngredient } from "./costing";

const garri: CostIngredient = { id: "g", name: "Garri", base_unit: "kg", current_cost_kobo: 85000 };
const conv = [{ ingredient_id: "g", market_unit: "mudu", base_qty: 1.5 }];

describe("countedToBase", () => {
  it("converts market units with the ingredient's own conversion", () => {
    expect(countedToBase(garri, 4, "mudu", conv)).toBe(6);
    expect(countedToBase(garri, 2.5, "kg", conv)).toBe(2.5);
    expect(countedToBase(garri, 500, "g", conv)).toBe(0.5);
  });
  it("is null when the unit cannot be converted, or nothing sensible was entered", () => {
    expect(countedToBase(garri, 1, "bag", conv)).toBeNull();
    expect(countedToBase(garri, -1, "kg", conv)).toBeNull();
    expect(countedToBase(garri, 1, "", conv)).toBeNull();
  });
});

describe("variance", () => {
  it("is counted minus expected, valued at today's price", () => {
    expect(variance(12, 10.5, 85000)).toEqual({ diff_base: -1.5, value_kobo: -127500, matches: false });
    expect(variance(5, 6, 85000)).toEqual({ diff_base: 1, value_kobo: 85000, matches: false });
  });
  it("treats a tiny difference as a match", () => {
    expect(variance(5, 5.0004, 85000)).toEqual({ diff_base: 0, value_kobo: 0, matches: true });
  });
});

describe("summarizeLosses", () => {
  const ings = [garri, { id: "r", name: "Rice", base_unit: "kg", current_cost_kobo: 200000 }];
  const m = (ingredient_id: string, qty_base: number, reason: string) => ({ ingredient_id, qty_base, reason, created_at: "2026-10-01T10:00:00Z" });
  it("adds up what stock-takes found missing, biggest loss first, and leaves out the opening count and normal use", () => {
    const s = summarizeLosses([
      m("g", -2, "count_correction"), m("g", -1, "count_correction"), m("r", -0.5, "count_correction"),
      m("g", -10, "opening_count"), m("g", -4, "sale_use"), m("g", 20, "purchase"), m("r", -1, "batch_use"),
    ], ings);
    expect(s.rows.map((r) => [r.name, r.lost_base, r.value_kobo])).toEqual([["Garri", 3, 255000], ["Rice", 0.5, 100000]]);
    expect(s.unexplained_kobo).toBe(355000);
  });
  it("a surplus is a negative loss", () => {
    const s = summarizeLosses([m("g", 2, "count_correction")], ings);
    expect(s.rows[0]!.lost_base).toBe(-2);
    expect(s.unexplained_kobo).toBe(-170000);
  });
  it("counts stock changed by hand and keeps logged wastage separate", () => {
    const s = summarizeLosses([m("g", -5, "unlabelled"), m("g", -2, "wastage"), m("g", 1, "wastage_removed")], ings);
    expect(s.by_hand_count).toBe(1);
    expect(s.rows[0]!.by_hand_base).toBe(-5);
    expect(s.wastage_kobo).toBe(85000);
    expect(s.unexplained_kobo).toBe(0);
  });
  it("ignores ingredients it does not know and gives nothing for no movements", () => {
    expect(summarizeLosses([m("zzz", -1, "count_correction")], ings).rows).toEqual([]);
    expect(summarizeLosses([], ings)).toEqual({ rows: [], unexplained_kobo: 0, by_hand_count: 0, wastage_kobo: 0 });
  });
  it("labels reasons in plain words", () => {
    expect(reasonLabel("sale_use")).toBe("Used in a sale");
    expect(reasonLabel("unlabelled")).toBe("Changed by hand");
    expect(reasonLabel("something_new")).toBe("something new");
  });
});
