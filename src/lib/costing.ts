// NairaPlate recipe costing — the ONE place plate cost and suggested price are calculated.
// Every screen (recipe builder, recipe list, future reports) calls computeRecipeCost().
// Pure function: no database calls, so it gives the same answer everywhere and is easy to test.

export type CostIngredient = {
  id: string;
  name: string;
  base_unit: string; // "kg" | "g" | "L" | "ml" | "piece" ...
  current_cost_kobo: number; // cost of ONE base unit, in kobo
};

export type CostConversion = {
  ingredient_id: string; // conversions are per ingredient — a derica of garri ≠ a derica of egusi
  market_unit: string; // "derica", "paint_rubber", "mudu", ...
  base_qty: number; // how many base units ONE market_unit holds, for THIS ingredient
};

export type CostRecipeItem = {
  ingredient_id: string;
  quantity: number;
  unit: string; // the ingredient's base unit, a metric sibling (g↔kg, ml↔L), or a market_unit
};

export type CostLine = {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  base_qty: number | null; // quantity converted into the ingredient's base unit
  base_unit: string;
  line_cost_kobo: number | null; // null when the unit could not be converted
  error: string | null;
};

export type RecipeCostResult = {
  lines: CostLine[];
  total_ingredient_cost_kobo: number; // exact (may be fractional) sum of line costs
  cost_per_plate_kobo: number; // rounded to the nearest kobo
  suggested_price_kobo: number | null; // rounded UP to the next kobo; null if it can't be priced
  errors: string[]; // any error means the totals are incomplete — never trust a partial cost
};

// Standard metric steps between base units, used only when the item unit and the base unit
// are both metric (e.g. recipe says 500 g, ingredient is costed per kg).
const METRIC: Record<string, { dim: "mass" | "volume"; factor: number }> = {
  g: { dim: "mass", factor: 1 },
  kg: { dim: "mass", factor: 1000 },
  ml: { dim: "volume", factor: 1 },
  l: { dim: "volume", factor: 1000 },
};

const norm = (u: string) => u.trim().toLowerCase();

/** Step 1: how many base units is `quantity` of `unit`, for this specific ingredient? */
export function toBaseQty(
  ingredient: CostIngredient,
  quantity: number,
  unit: string,
  conversions: CostConversion[],
): { base_qty: number | null; error: string | null } {
  const u = norm(unit);
  const base = norm(ingredient.base_unit);

  if (u === base) return { base_qty: quantity, error: null };

  // Market unit: must match a unit_conversions row for THIS ingredient.
  const conv = conversions.find((c) => c.ingredient_id === ingredient.id && norm(c.market_unit) === u);
  if (conv) return { base_qty: quantity * Number(conv.base_qty), error: null };

  // Metric-to-metric in the same dimension (g→kg, L→ml).
  const from = METRIC[u];
  const to = METRIC[base];
  if (from && to && from.dim === to.dim) return { base_qty: (quantity * from.factor) / to.factor, error: null };

  return {
    base_qty: null,
    error: `No conversion for "${unit}" on ${ingredient.name} (base unit ${ingredient.base_unit}). Add one on the Ingredients screen.`,
  };
}

/**
 * ONE ingredient: convert qty + unit to its base unit (its own unit_conversions row,
 * or metric sibling), then multiply by current_cost_kobo per base unit.
 * Used by computeRecipeCost() for every recipe_item AND by the wastage screen.
 * cost_kobo is null (never 0) when the unit can't be converted.
 */
export function convertAndCostIngredient(input: {
  ingredientId: string;
  qty: number;
  unit: string;
  ingredients: CostIngredient[];
  conversions: CostConversion[];
}): { cost_kobo: number | null; base_qty: number | null; ingredient: CostIngredient | null; error: string | null } {
  const ing = input.ingredients.find((i) => i.id === input.ingredientId) ?? null;
  if (!ing) return { cost_kobo: null, base_qty: null, ingredient: null, error: "Ingredient not found." };
  const { base_qty, error } = toBaseQty(ing, Number(input.qty), input.unit, input.conversions);
  return {
    cost_kobo: base_qty === null ? null : base_qty * Number(ing.current_cost_kobo),
    base_qty, ingredient: ing, error,
  };
}

/** Units that can be costed for an ingredient: base unit, metric siblings, and ITS OWN conversions. */
export function unitsForIngredient(ing: CostIngredient | undefined, conversions: CostConversion[]): string[] {
  if (!ing) return [];
  const metric = ["kg", "g"].includes(ing.base_unit) ? ["kg", "g"] : ["L", "ml"].includes(ing.base_unit) ? ["L", "ml"] : [ing.base_unit];
  const own = conversions.filter((c) => c.ingredient_id === ing.id).map((c) => c.market_unit);
  return Array.from(new Set([ing.base_unit, ...metric, ...own]));
}

/**
 * Cost of a recipe.
 *  1. convert each recipe_item to the ingredient's base unit (per-ingredient unit_conversions)
 *  2. multiply by the ingredient's current_cost_kobo per base unit
 *  3. sum → total ingredient cost
 *  4. divide by yield_portions → cost_per_plate_kobo
 *  5. suggested_price_kobo = cost_per_plate_kobo / (1 - target_margin_bps / 10000)
 */
export function computeRecipeCost(input: {
  items: CostRecipeItem[];
  ingredients: CostIngredient[];
  conversions: CostConversion[];
  yield_portions: number;
  target_margin_bps: number; // from businesses.target_margin_bps, e.g. 3500 = 35%
}): RecipeCostResult {
  const { items, ingredients, conversions, yield_portions, target_margin_bps } = input;
  const errors: string[] = [];

  // Steps 1–2 — delegated to the shared single-ingredient function.
  const lines: CostLine[] = items.map((item) => {
    const r = convertAndCostIngredient({
      ingredientId: item.ingredient_id, qty: Number(item.quantity), unit: item.unit, ingredients, conversions,
    });
    if (r.error) errors.push(r.error);
    return {
      ingredient_id: item.ingredient_id,
      ingredient_name: r.ingredient?.name ?? "Unknown",
      quantity: Number(item.quantity),
      unit: item.unit,
      base_qty: r.base_qty,
      base_unit: r.ingredient?.base_unit ?? "",
      line_cost_kobo: r.cost_kobo,
      error: r.error,
    };
  });

  // Step 3
  const total_ingredient_cost_kobo = lines.reduce((sum, l) => sum + (l.line_cost_kobo ?? 0), 0);

  // Step 4
  if (!(yield_portions > 0)) errors.push("Yield must be at least 1 portion.");
  const exactPerPlate = yield_portions > 0 ? total_ingredient_cost_kobo / yield_portions : 0;
  const cost_per_plate_kobo = Math.round(exactPerPlate);

  // Step 5
  let suggested_price_kobo: number | null = null;
  if (target_margin_bps < 0 || target_margin_bps >= 10000) {
    errors.push("Target margin must be between 0% and 99.99%.");
  } else if (yield_portions > 0) {
    suggested_price_kobo = Math.ceil(exactPerPlate / (1 - target_margin_bps / 10000));
  }

  return { lines, total_ingredient_cost_kobo, cost_per_plate_kobo, suggested_price_kobo, errors };
}

// Money helpers shared by every screen.
export const formatNaira = (kobo: number | null | undefined) =>
  kobo === null || kobo === undefined
    ? "—"
    : `${kobo < 0 ? "−" : ""}₦${(Math.abs(kobo) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const nairaToKobo = (naira: string) => Math.round(Number(naira || 0) * 100);
export const koboToNaira = (kobo: number) => (kobo / 100).toString();
