import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import {
  convertAndCostIngredient, computeRecipeCost, formatNaira, nairaToKobo,
  type CostIngredient, type CostConversion, type CostRecipeItem,
} from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/batches")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Log a batch — NairaPlate" },
      { name: "description", content: "Record a cooked batch, use up stock and see the real cost per plate." },
      { property: "og:title", content: "Log a batch — NairaPlate" },
      { property: "og:description", content: "Record a cooked batch, use up stock and see the real cost per plate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BatchScreen,
});

const ROLES = new Set(["cook", "owner", "supa_admin"]);
type Recipe = { id: string; name: string; yield_portions: number };
type Item = CostRecipeItem & { recipe_id: string };
type Summary = {
  recipe: string; ingredient_cost_kobo: number; packaging_kobo: number; utilities_kobo: number;
  actual_yield: number; theoretical_yield: number; realized_per_plate: number; recipe_per_plate: number; flags: number;
};

function BatchScreen() {
  const { loading, session } = useStaffSession();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [scale, setScale] = useState("1");
  const [actual, setActual] = useState("");
  const [packaging, setPackaging] = useState("");
  const [utilities, setUtilities] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function load() {
    const [r, ri, i, c] = await Promise.all([
      supabase.from("recipes").select("id,name,yield_portions").order("name"),
      supabase.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit"),
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
    ]);
    setRecipes((r.data ?? []).map((x) => ({ ...x, yield_portions: Number(x.yield_portions) })));
    setItems((ri.data ?? []).map((x) => ({ ...x, quantity: Number(x.quantity) })));
    setIngredients((i.data ?? []).map((x) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo) })));
    setConversions((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
  }
  useEffect(() => { load(); }, []);

  const recipe = recipes.find((r) => r.id === recipeId);
  const scaleNum = Number(scale);
  const theoretical = recipe && scaleNum > 0 ? recipe.yield_portions * scaleNum : null;

  // Every scaled recipe_item goes through the shared convertAndCostIngredient().
  const plan = useMemo(() => {
    if (!recipe || !(scaleNum > 0)) return null;
    const lines = items.filter((it) => it.recipe_id === recipe.id).map((it) =>
      convertAndCostIngredient({
        ingredientId: it.ingredient_id, qty: it.quantity * scaleNum, unit: it.unit, ingredients, conversions,
      }));
    const errors = lines.map((l) => l.error).filter((e): e is string => !!e);
    if (lines.length === 0) errors.push("This recipe has no ingredients.");
    const ingredient_cost_kobo = Math.round(lines.reduce((s, l) => s + (l.cost_kobo ?? 0), 0));
    // Same ingredient may appear twice in a recipe — combine before deducting.
    const byIng = new Map<string, number>();
    for (const l of lines) if (l.ingredient && l.base_qty !== null)
      byIng.set(l.ingredient.id, (byIng.get(l.ingredient.id) ?? 0) + l.base_qty);
    const deductions = [...byIng].map(([ingredient_id, base_qty]) => ({ ingredient_id, base_qty }));
    return { lines, errors, ingredient_cost_kobo, deductions };
  }, [recipe, scaleNum, items, ingredients, conversions]);

  async function submit() {
    if (!recipe || !plan || plan.errors.length) return; // blocked before ANY database write
    setBusy(true); setErr(null); setSummary(null);
    const packaging_kobo = nairaToKobo(packaging);
    const utilities_kobo = nairaToKobo(utilities);
    const actualNum = Number(actual);
    const { data, error } = await supabase.rpc("log_batch" as never, {
      p_recipe_id: recipe.id, p_scale_factor: scaleNum, p_actual_yield: actualNum,
      p_ingredient_cost_kobo: plan.ingredient_cost_kobo, p_packaging_kobo: packaging_kobo,
      p_utilities_kobo: utilities_kobo, p_deductions: plan.deductions,
    } as never);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const recipeCost = computeRecipeCost({
      items: items.filter((it) => it.recipe_id === recipe.id), ingredients, conversions,
      yield_portions: recipe.yield_portions, target_margin_bps: 0,
    });
    setSummary({
      recipe: recipe.name, ingredient_cost_kobo: plan.ingredient_cost_kobo, packaging_kobo, utilities_kobo,
      actual_yield: actualNum, theoretical_yield: theoretical ?? 0,
      realized_per_plate: Math.round((plan.ingredient_cost_kobo + packaging_kobo + utilities_kobo) / actualNum),
      recipe_per_plate: recipeCost.cost_per_plate_kobo,
      flags: Number((data as { low_stock_flags?: number } | null)?.low_stock_flags ?? 0),
    });
    setActual(""); setPackaging(""); setUtilities(""); setScale("1");
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Only kitchen staff and owners can log batches.</p><Link className="underline" to="/">Home</Link></main>;

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  const canSubmit = !!plan && plan.errors.length === 0 && Number(actual) > 0 && !busy;
  const diff = summary ? summary.realized_per_plate - summary.recipe_per_plate : 0;

  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Log a batch</h1><Link className="underline" to="/">Home</Link></div>
      <div className="space-y-1"><Label htmlFor="b-recipe">Dish cooked</Label>
        <select id="b-recipe" className={sel} value={recipeId} onChange={(e) => { setRecipeId(e.target.value); setSummary(null); }}>
          <option value="">Choose…</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="b-scale">How many times the recipe</Label>
          <Input id="b-scale" type="number" min={0} step="0.1" value={scale} onChange={(e) => setScale(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label>Plates expected</Label>
          <p className="h-10 flex items-center font-semibold" data-testid="theoretical">{theoretical ?? "—"}</p></div>
      </div>
      <div className="space-y-1"><Label htmlFor="b-actual">Plates actually made</Label>
        <Input id="b-actual" type="number" min={0} value={actual} onChange={(e) => setActual(e.target.value)} /></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="b-pack">Packaging (₦, optional)</Label>
          <Input id="b-pack" type="number" min={0} value={packaging} onChange={(e) => setPackaging(e.target.value)} placeholder="0" /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="b-util">Gas / power (₦, optional)</Label>
          <Input id="b-util" type="number" min={0} value={utilities} onChange={(e) => setUtilities(e.target.value)} placeholder="0" /></div>
      </div>
      {plan && plan.errors.map((e) => <p key={e} className="text-sm text-destructive" role="alert">{e}</p>)}
      {plan && plan.errors.length === 0 && (
        <div className="text-sm rounded-md border p-3 space-y-1">
          <p className="font-medium">Ingredients this batch uses up</p>
          {plan.lines.map((l, i) => (
            <p key={i}>{l.ingredient?.name}: {Number((l.base_qty ?? 0).toFixed(3))} {l.ingredient?.base_unit} · {formatNaira(Math.round(l.cost_kobo ?? 0))}</p>
          ))}
          <p className="font-semibold">Ingredient cost: {formatNaira(plan.ingredient_cost_kobo)}</p>
        </div>
      )}
      <Button className="w-full" disabled={!canSubmit} onClick={submit}>Save batch</Button>
      {err && <p className="text-destructive" role="alert">{err}</p>}
      {summary && (
        <div className="rounded-md border p-3 space-y-1" data-testid="summary">
          <p className="font-semibold">Saved: {summary.recipe}</p>
          <p>Ingredients {formatNaira(summary.ingredient_cost_kobo)} + packaging {formatNaira(summary.packaging_kobo)} + gas/power {formatNaira(summary.utilities_kobo)}</p>
          <p>{summary.actual_yield} plates made (expected {summary.theoretical_yield})</p>
          <p>Real cost per plate this batch: <strong>{formatNaira(summary.realized_per_plate)}</strong></p>
          <p>Recipe estimate per plate: {formatNaira(summary.recipe_per_plate)}</p>
          {diff > 0
            ? <p className="text-destructive font-semibold" role="alert">This batch cost {formatNaira(diff)} MORE per plate than the recipe estimate — check for fewer plates than expected or waste.</p>
            : <p className="text-primary">This batch cost {formatNaira(-diff)} less (or the same) per plate than the recipe estimate.</p>}
          {summary.flags > 0 && <p className="text-sm">Low stock: {summary.flags} ingredient(s) flagged for the purchaser.</p>}
        </div>
      )}
    </main>
  );
}
