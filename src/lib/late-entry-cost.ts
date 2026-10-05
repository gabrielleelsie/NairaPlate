// Paper-sale (late entry) food-cost labels. The database decides the cost basis; screens only label it.
export type CostBasis = "sale_time_exact" | "sale_time_backfilled" | "estimated_current_price" | "unknown_held" | "not_applicable";

export function costBasisLabel(b: string | null | undefined): string | null {
  switch (b) {
    case "sale_time_exact": return "Costed at sale time";
    case "sale_time_backfilled": return "Costed at sale time — reconstructed history";
    case "estimated_current_price": return "Estimated — today's prices";
    case "unknown_held": return "Food cost unknown at sale time";
    case "not_applicable": return "No food cost applies";
    default: return null;
  }
}

/** Worst label across a sale's lines, so one estimated line marks the whole sale. */
export function overallCostBasis(list: (string | null | undefined)[]): string | null {
  const order = ["unknown_held", "estimated_current_price", "sale_time_backfilled", "sale_time_exact", "not_applicable"];
  for (const b of order) if (list.includes(b)) return b;
  return null;
}

const REASONS: Record<string, string> = {
  no_price_before_sale_time: "no price recorded before the sale time",
  no_price_at_time: "no price in force at the sale time",
  grade_history_unavailable: "no price history for this grade",
  unit_conversion_unavailable: "recipe unit cannot be converted",
  recipe_unavailable: "recipe not found",
  recipe_has_no_ingredients: "recipe has no ingredients",
};
export const reasonLabel = (r: string) => REASONS[r] ?? r;

export type UnresolvedIngredient = { ingredient_id: string | null; ingredient_name: string | null; reason: string };
export type CostAt = { total_cost_per_plate_kobo: number | null; cost_status: CostBasis; is_complete: boolean; unresolved_ingredients: UnresolvedIngredient[] };
export type CostPreview = {
  is_complete: boolean;
  overall_status: CostBasis;
  lines: { dish_name: string; quantity: number; cost: CostAt; today_cost_per_plate_kobo: number | null }[];
};
