import { describe, expect, it } from "vitest";
import { compareVariants, labelProblem, sameRecipe, type RecipeVariant } from "./variants";
import type { CostIngredient } from "./costing";

const ing: CostIngredient[] = [
  { id: "t", name: "Tomato", base_unit: "kg", current_cost_kobo: 100000, grade_prices: { A: 120000 } },
  { id: "p", name: "Pumpkin", base_unit: "kg", current_cost_kobo: 40000 },
];
const std = { items: [{ ingredient_id: "t", quantity: 1, unit: "kg" }], yield_portions: 1 };
const lean: RecipeVariant = { id: "v1", dish_id: "d", label: "Lean season", yield_portions: 1, items: [{ ingredient_id: "t", quantity: 0.6, unit: "kg" }, { ingredient_id: "p", quantity: 0.4, unit: "kg" }] };
const same: RecipeVariant = { id: "v2", dish_id: "d", label: "Standard", yield_portions: 1, items: [{ ingredient_id: "t", quantity: 1, unit: "KG" }] };

describe("sameRecipe", () => {
  it("ignores order and unit case, but not quantity or plates", () => {
    expect(sameRecipe(std, same)).toBe(true);
    expect(sameRecipe(std, { ...same, yield_portions: 2 })).toBe(false);
    expect(sameRecipe(std, { items: [{ ingredient_id: "t", quantity: 0.9, unit: "kg" }], yield_portions: 1 })).toBe(false);
    expect(sameRecipe({ items: [...lean.items], yield_portions: 1 }, { items: [...lean.items].reverse(), yield_portions: 1 })).toBe(true);
  });
});

describe("compareVariants", () => {
  const base = { current: std, price_kobo: 300000, grade: null as string | null, ingredients: ing, conversions: [] };
  it("costs the dish and each variant side by side and marks the active one", () => {
    const r = compareVariants({ ...base, variants: [lean, same] });
    expect(r.current.cost_per_plate_kobo).toBe(100000);
    const l = r.rows.find((x) => x.id === "v1")!;
    expect(l.cost_per_plate_kobo).toBe(76000); // 0.6 * 100000 + 0.4 * 40000
    expect(l.cost_diff_kobo).toBe(-24000);
    expect(Math.round(l.margin_pct!)).toBe(75);
    expect(l.active).toBe(false);
    expect(r.rows.find((x) => x.id === "v2")!.active).toBe(true);
    expect(r.current_matches).toBe("Standard");
  });
  it("uses the dish's grade for every variant", () => {
    const r = compareVariants({ ...base, grade: "A", variants: [lean] });
    expect(r.current.cost_per_plate_kobo).toBe(120000);
    expect(r.rows[0]!.cost_per_plate_kobo).toBe(88000); // 0.6 * 120000 + 0.4 * 40000 (pumpkin has no grade A price)
    expect(r.rows[0]!.fallbacks).toEqual(["Pumpkin"]);
  });
  it("says so when a variant cannot be costed, instead of a number", () => {
    const bad: RecipeVariant = { ...lean, id: "v3", items: [{ ingredient_id: "t", quantity: 1, unit: "bag" }] };
    const r = compareVariants({ ...base, variants: [bad] });
    expect(r.rows[0]!.cost_per_plate_kobo).toBeNull();
    expect(r.rows[0]!.error).toMatch(/No conversion/);
  });
  it("reports no match when the current recipe is not saved as a variant", () => {
    expect(compareVariants({ ...base, variants: [lean] }).current_matches).toBeNull();
  });
});

describe("labelProblem", () => {
  const ex = [{ id: "a", label: "Lean season" }];
  it("applies the same rules as the database", () => {
    expect(labelProblem("", [])).toMatch(/name/);
    expect(labelProblem("x".repeat(41), [])).toMatch(/40/);
    expect(labelProblem("  lean SEASON ", ex)).toMatch(/already has/);
    expect(labelProblem("Lean season", ex, "a")).toBeNull(); // renaming itself is fine
    expect(labelProblem("Festive", ex)).toBeNull();
    expect(labelProblem("Sixth", Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: `V${i}` })))).toMatch(/up to 5/);
  });
});
