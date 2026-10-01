import { describe, expect, it } from "vitest";
import { computeRecipeCost, gradesWithPrices, hasGradeChoice, type CostIngredient } from "./costing";

const tomato: CostIngredient = { id: "t", name: "Tomato", base_unit: "kg", current_cost_kobo: 100000, grade_prices: { A: 120000, B: 80000 } };
const garri: CostIngredient = { id: "g", name: "Garri", base_unit: "kg", current_cost_kobo: 50000 };
const conversions = [{ ingredient_id: "g", market_unit: "derica", base_qty: 0.5 }];
const items = [{ ingredient_id: "t", quantity: 500, unit: "g" }, { ingredient_id: "g", quantity: 2, unit: "derica" }];
const base = { items, ingredients: [tomato, garri], conversions, yield_portions: 2, target_margin_bps: 0 };

// Same numbers as the database test of recipe_plate_cost_kobo(): 50000 / 55000 / 45000 per plate.
describe("computeRecipeCost with grades", () => {
  it("uses the latest price when no grade is set", () => {
    const c = computeRecipeCost(base);
    expect(c.cost_per_plate_kobo).toBe(50000);
    expect(c.fallbacks).toEqual([]);
  });
  it("uses each grade's price", () => {
    expect(computeRecipeCost({ ...base, grade: "A" }).cost_per_plate_kobo).toBe(55000);
    expect(computeRecipeCost({ ...base, grade: "B" }).cost_per_plate_kobo).toBe(45000);
  });
  it("falls back to the latest price and names the ingredient", () => {
    const c = computeRecipeCost({ ...base, grade: "C" });
    expect(c.cost_per_plate_kobo).toBe(50000);
    expect(c.fallbacks.sort()).toEqual(["Garri", "Tomato"]);
    expect(computeRecipeCost({ ...base, grade: "A" }).fallbacks).toEqual(["Garri"]);
  });
  it("does not warn about ingredients that are not in the dish", () => {
    const c = computeRecipeCost({ ...base, items: [items[1]!], grade: "A" });
    expect(c.fallbacks).toEqual(["Garri"]);
  });
  it("shows a grade switch only when an ingredient has two or more grades", () => {
    expect(hasGradeChoice([tomato, garri], ["t", "g"])).toBe(true);
    expect(hasGradeChoice([tomato, garri], ["g"])).toBe(false);
    expect(hasGradeChoice([{ ...tomato, grade_prices: { A: 1 } }], ["t"])).toBe(false);
    expect(gradesWithPrices([tomato, garri], ["t", "g"])).toEqual(["A", "B"]);
  });
});
