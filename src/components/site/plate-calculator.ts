// Real Eba & Egusi costing data, shared by the marketing hero and the live calculator.
// Prices are the same market prices the app's own demo kitchen uses.
import type { CostConversion, CostIngredient, CostRecipeItem } from "@/lib/costing";

export const DEMO_INGREDIENTS: CostIngredient[] = [
  { id: "garri", name: "Garri", base_unit: "kg", current_cost_kobo: 129200 },
  { id: "egusi", name: "Egusi", base_unit: "kg", current_cost_kobo: 372700 },
];

// A derica of garri holds 0.9 kg; a mudu of egusi holds 1.1 kg.
export const DEMO_CONVERSIONS: CostConversion[] = [
  { ingredient_id: "garri", market_unit: "derica", base_qty: 0.9 },
  { ingredient_id: "egusi", market_unit: "mudu", base_qty: 1.1 },
];

export const EBA_EGUSI_ITEMS: CostRecipeItem[] = [
  { ingredient_id: "garri", quantity: 2, unit: "derica" },
  { ingredient_id: "egusi", quantity: 500, unit: "g" },
];

export const EBA_EGUSI_PLATES = 10;
