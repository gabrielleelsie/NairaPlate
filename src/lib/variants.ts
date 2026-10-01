// Recipe variants: named ingredient lists for one dish (for example "Standard" and "Lean season").
// A variant is only a SAVED list. The dish changes when an owner switches to one, which saves a normal new recipe version.
// Costs come from computeRecipeCost(), the one shared costing function, at the dish's own grade.
import { computeRecipeCost, type CostConversion, type CostIngredient } from "@/lib/costing";

export type VariantItem = { ingredient_id: string; quantity: number; unit: string; min_quantity?: number | null; never_cut?: boolean };
export type RecipeVariant = { id: string; dish_id: string; label: string; yield_portions: number; items: VariantItem[] };

export const MAX_VARIANTS = 5;
export const MAX_LABEL = 40;

const key = (i: { ingredient_id: string; quantity: number; unit: string }) => `${i.ingredient_id}|${Number(i.quantity)}|${i.unit.trim().toLowerCase()}`;

/** Do two ingredient lists (and plate counts) describe the same recipe? Order does not matter. */
export function sameRecipe(
  a: { items: { ingredient_id: string; quantity: number; unit: string }[]; yield_portions: number },
  b: { items: { ingredient_id: string; quantity: number; unit: string }[]; yield_portions: number },
): boolean {
  if (Number(a.yield_portions) !== Number(b.yield_portions)) return false;
  return a.items.map(key).sort().join(";") === b.items.map(key).sort().join(";");
}

export type VariantRow = {
  id: string; label: string; active: boolean;
  cost_per_plate_kobo: number | null; margin_pct: number | null;
  cost_diff_kobo: number | null; // against what the dish costs now; negative = cheaper
  fallbacks: string[]; error: string | null;
};

/** Cost and margin of the dish as it is now and of every variant, side by side at the dish's grade and selling price. */
export function compareVariants(input: {
  current: { items: VariantItem[]; yield_portions: number };
  price_kobo: number; grade: string | null; variants: RecipeVariant[];
  ingredients: CostIngredient[]; conversions: CostConversion[];
}): { current: Omit<VariantRow, "id" | "label" | "active" | "cost_diff_kobo">; rows: VariantRow[]; current_matches: string | null } {
  const { current, price_kobo, grade, variants, ingredients, conversions } = input;
  const cost = (x: { items: VariantItem[]; yield_portions: number }) => {
    const c = computeRecipeCost({ items: x.items, ingredients, conversions, yield_portions: Number(x.yield_portions), target_margin_bps: 0, grade });
    if (c.errors.length) return { cost: null as number | null, margin: null as number | null, fallbacks: c.fallbacks, error: c.errors[0]! };
    const per = c.total_ingredient_cost_kobo / Number(x.yield_portions);
    return { cost: Math.round(per), margin: price_kobo > 0 ? (1 - per / price_kobo) * 100 : null, fallbacks: c.fallbacks, error: null as string | null };
  };
  const cur = cost(current);
  const rows = variants.map((v) => {
    const c = cost(v);
    const active = sameRecipe(current, v);
    return {
      id: v.id, label: v.label, active, cost_per_plate_kobo: c.cost, margin_pct: c.margin,
      cost_diff_kobo: c.cost !== null && cur.cost !== null ? c.cost - cur.cost : null, fallbacks: c.fallbacks, error: c.error,
    };
  });
  return {
    current: { cost_per_plate_kobo: cur.cost, margin_pct: cur.margin, fallbacks: cur.fallbacks, error: cur.error },
    rows, current_matches: rows.find((r) => r.active)?.label ?? null,
  };
}

/** Why a label cannot be used, or null if it is fine. Mirrors the database rules. */
export function labelProblem(label: string, existing: { id: string; label: string }[], editingId?: string): string | null {
  const t = label.trim();
  if (t.length < 1) return "Give the variant a name.";
  if (t.length > MAX_LABEL) return `Use ${MAX_LABEL} characters or fewer.`;
  if (existing.some((v) => v.id !== editingId && v.label.trim().toLowerCase() === t.toLowerCase())) return `This dish already has a variant called "${t}".`;
  if (!editingId && existing.length >= MAX_VARIANTS) return `A dish can have up to ${MAX_VARIANTS} variants. Delete one first.`;
  return null;
}
