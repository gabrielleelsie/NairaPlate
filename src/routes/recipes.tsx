import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, BASE_UNITS } from "@/lib/staff-session";
import {
  computeRecipeCost, unitsForIngredient, formatNaira, nairaToKobo,
  type CostIngredient, type CostConversion, type CostRecipeItem,
} from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PricingReview } from "@/components/PricingReview";

export const Route = createFileRoute("/recipes")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recipes & plate cost — NairaPlate" },
      { name: "description", content: "Build recipes and see the true cost per plate and a suggested selling price." },
      { property: "og:title", content: "Recipes & plate cost — NairaPlate" },
      { property: "og:description", content: "Build recipes and see the true cost per plate and a suggested selling price." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecipesScreen,
});

type Recipe = { id: string; name: string; category: string | null; yield_portions: number; selling_price_kobo: number };
type RecipeItemRow = CostRecipeItem & { id: string; recipe_id: string };
type DraftItem = { key: number; existingId?: string; ingredient_id: string; quantity: string; unit: string };

const EDIT_ROLES = new Set(["owner", "supa_admin", "cook"]);
const DELETE_ROLES = new Set(["owner", "supa_admin"]);

function RecipesScreen() {
  const { loading, session } = useStaffSession();
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeItems, setRecipeItems] = useState<RecipeItemRow[]>([]);
  const [marginBps, setMarginBps] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [ing, conv, rec, ri, biz] = await Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
      supabase.from("recipes").select("id,name,category,yield_portions,selling_price_kobo").order("name"),
      supabase.from("recipe_items").select("id,recipe_id,ingredient_id,quantity,unit"),
      supabase.from("businesses").select("target_margin_bps").maybeSingle(),
    ]);
    if (ing.error || conv.error || rec.error || ri.error || biz.error) return setMsg({ ok: false, text: "Could not load recipes." });
    setIngredients((ing.data ?? []).map((i) => ({ ...i, current_cost_kobo: Number(i.current_cost_kobo) })));
    setConversions((conv.data ?? []).map((c) => ({ ...c, base_qty: Number(c.base_qty) })));
    setRecipes((rec.data ?? []).map((r) => ({ ...r, yield_portions: Number(r.yield_portions), selling_price_kobo: Number(r.selling_price_kobo) })));
    setRecipeItems((ri.data ?? []).map((r) => ({ ...r, quantity: Number(r.quantity) })));
    setMarginBps(biz.data ? Number(biz.data.target_margin_bps) : null);
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;

  const canEdit = EDIT_ROLES.has(session.role);
  const canDelete = DELETE_ROLES.has(session.role);

  async function deleteRecipe(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    const { error: itemsErr } = await supabase.from("recipe_items").delete().eq("recipe_id", id);
    if (itemsErr) return setMsg({ ok: false, text: "Could not delete the recipe's ingredients." });
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) return setMsg({ ok: false, text: "Could not delete the recipe." });
    setMsg({ ok: true, text: `${name} deleted.` });
    load();
  }

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Recipes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Target margin: {marginBps === null ? "not set" : `${marginBps / 100}%`}
      </p>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>}

      {canEdit && marginBps !== null && editingId === null && (
        <RecipeForm
          businessId={session.businessId}
          ingredients={ingredients}
          conversions={conversions}
          marginBps={marginBps}
          onSaved={(t) => { setMsg({ ok: true, text: t }); load(); }}
          onError={(t) => setMsg({ ok: false, text: t })}
        />
      )}

      {canEdit && marginBps !== null && editingId !== null && (() => {
        const r = recipes.find((x) => x.id === editingId);
        if (!r) return null;
        return (
          <RecipeForm
            key={r.id}
            businessId={session.businessId}
            ingredients={ingredients}
            conversions={conversions}
            marginBps={marginBps}
            existing={r}
            existingItems={recipeItems.filter((i) => i.recipe_id === r.id)}
            canDeleteItems={canDelete}
            onSaved={(t) => { setMsg({ ok: true, text: t }); setEditingId(null); load(); }}
            onError={(t) => setMsg({ ok: false, text: t })}
            onCancel={() => setEditingId(null)}
          />
        );
      })()}

      {canDelete && marginBps !== null && session.userId && (
        <PricingReview
          businessId={session.businessId}
          userId={session.userId}
          recipes={recipes}
          recipeItems={recipeItems}
          ingredients={ingredients}
          conversions={conversions}
          marginBps={marginBps}
          onAdjust={(id) => { setEditingId(id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onChanged={load}
        />
      )}

      <h2 className="mt-10 text-lg font-medium text-foreground">Saved recipes</h2>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {recipes.length === 0 && <li className="p-4 text-sm text-muted-foreground">No recipes yet.</li>}
        {recipes.map((r) => {
          // Same single costing function as the builder.
          const cost = computeRecipeCost({
            items: recipeItems.filter((i) => i.recipe_id === r.id),
            ingredients, conversions, yield_portions: r.yield_portions, target_margin_bps: marginBps ?? 0,
          });
          const below = cost.errors.length === 0 && r.selling_price_kobo < (cost.suggested_price_kobo ?? 0);
          return (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{[r.category, `${r.yield_portions} plates`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-foreground">Selling {formatNaira(r.selling_price_kobo)}</div>
                  <div className="text-muted-foreground">Cost/plate {cost.errors.length ? "—" : formatNaira(cost.cost_per_plate_kobo)}</div>
                  <div className={below ? "text-destructive" : "text-muted-foreground"}>
                    Suggested {cost.errors.length ? "—" : formatNaira(cost.suggested_price_kobo)}
                  </div>
                </div>
              </div>
              {cost.errors.length > 0 && <p className="mt-2 text-xs text-destructive">{cost.errors[0]}</p>}
              {canEdit && editingId !== r.id && (
                <div className="mt-3 flex gap-3">
                  <button type="button" className="text-sm underline text-foreground" onClick={() => { setEditingId(r.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    Edit
                  </button>
                  {canDelete && (
                    <button type="button" className="text-sm underline text-destructive" onClick={() => deleteRecipe(r.id, r.name)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

// One form for both "New recipe" and editing a saved recipe.
// existing === null → create. existing set → update the recipe row and
// add / change / remove its ingredients in place.
function RecipeForm({
  businessId, ingredients, conversions, marginBps, existing, existingItems, canDeleteItems,
  onSaved, onError, onCancel,
}: {
  businessId: string; ingredients: CostIngredient[]; conversions: CostConversion[]; marginBps: number;
  existing?: Recipe; existingItems?: RecipeItemRow[]; canDeleteItems?: boolean;
  onSaved: (t: string) => void; onError: (t: string) => void; onCancel?: () => void;
}) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [yieldPortions, setYieldPortions] = useState(existing ? String(existing.yield_portions) : "1");
  const defaultPct = Math.min(90, Math.max(0, Math.round(marginBps / 100)));

  // In edit mode, start the slider at the margin implied by the saved price,
  // and keep the saved price as an override so nothing changes by surprise.
  const [marginPct, setMarginPct] = useState(() => {
    if (!existing || !existingItems || existingItems.length === 0) return defaultPct;
    const c = computeRecipeCost({
      items: existingItems, ingredients, conversions,
      yield_portions: existing.yield_portions, target_margin_bps: 0,
    });
    if (c.errors.length || c.cost_per_plate_kobo <= 0) return defaultPct;
    return Math.min(90, Math.max(0, Math.round((1 - c.cost_per_plate_kobo / existing.selling_price_kobo) * 100)));
  });
  const [override, setOverride] = useState(isEdit);
  const [customPrice, setCustomPrice] = useState(existing ? (existing.selling_price_kobo / 100).toFixed(2) : "");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>(() =>
    existingItems
      ? existingItems.map((i, n) => ({ key: n + 1, existingId: i.id, ingredient_id: i.ingredient_id, quantity: String(i.quantity), unit: i.unit }))
      : [],
  );
  const [nextKey, setNextKey] = useState((existingItems?.length ?? 0) + 1);
  const [busy, setBusy] = useState(false);

  // Units offered for an ingredient: its base unit, metric siblings, and ITS OWN conversions only.
  const unitsFor = (ingredientId: string) => unitsForIngredient(ingredients.find((i) => i.id === ingredientId), conversions);

  const costItems = useMemo(
    () => items
      .filter((i) => i.ingredient_id && Number(i.quantity) > 0)
      .map((i) => ({ ingredient_id: i.ingredient_id, quantity: Number(i.quantity), unit: i.unit })),
    [items],
  );

  // Live cost at the slider's margin — calls the one shared costing function.
  const cost = useMemo(
    () => computeRecipeCost({
      items: costItems, ingredients, conversions,
      yield_portions: Number(yieldPortions),
      target_margin_bps: marginPct * 100,
    }),
    [costItems, ingredients, conversions, yieldPortions, marginPct],
  );

  // Same function at the business default margin — used only for the override warning.
  const defaultCost = useMemo(
    () => computeRecipeCost({
      items: costItems, ingredients, conversions,
      yield_portions: Number(yieldPortions),
      target_margin_bps: marginBps,
    }),
    [costItems, ingredients, conversions, yieldPortions, marginBps],
  );

  const update = (key: number, patch: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function removeItem(it: DraftItem) {
    if (it.existingId && !canDeleteItems) return;
    setItems((xs) => xs.filter((x) => x.key !== it.key));
  }

  function toggleOverride(on: boolean) {
    setOverride(on);
    setPriceError(null);
    if (on) {
      setCustomPrice(
        isEdit && existing ? (existing.selling_price_kobo / 100).toFixed(2)
          : cost.suggested_price_kobo !== null ? (cost.suggested_price_kobo / 100).toFixed(2)
          : "",
      );
    } else {
      setCustomPrice("");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const valid = items.filter((i) => i.ingredient_id && Number(i.quantity) > 0);
    if (!name.trim()) return onError("Recipe name is required.");
    if (!(Number(yieldPortions) > 0)) return onError("Yield must be at least 1 plate.");
    if (valid.length === 0) return onError("Add at least one ingredient.");
    if (cost.errors.length) return onError(cost.errors[0]!);
    let priceKobo: number;
    if (override) {
      const n = Number(customPrice);
      if (!customPrice.trim() || !Number.isFinite(n) || n <= 0) { setPriceError("Enter a valid price"); return; }
      priceKobo = nairaToKobo(customPrice);
    } else {
      if (cost.suggested_price_kobo === null) return onError("Could not compute a price.");
      priceKobo = cost.suggested_price_kobo;
    }
    setPriceError(null);
    setBusy(true);

    if (isEdit && existing) {
      const { error: recErr } = await supabase.from("recipes").update({
        name: name.trim(), category: category.trim() || null,
        yield_portions: Number(yieldPortions), selling_price_kobo: priceKobo,
      }).eq("id", existing.id);
      if (recErr) { setBusy(false); return onError("Could not save the recipe details."); }

      const keptIds = new Set(valid.map((i) => i.existingId).filter(Boolean) as string[]);
      const toDelete = (existingItems ?? []).filter((e) => !keptIds.has(e.id));
      if (toDelete.length) {
        if (!canDeleteItems) { setBusy(false); return onError("Only an owner can remove ingredients from a saved recipe."); }
        const { error } = await supabase.from("recipe_items").delete().in("id", toDelete.map((e) => e.id));
        if (error) { setBusy(false); return onError("Could not remove ingredients."); }
      }
      for (const d of valid) {
        if (!d.existingId) continue;
        const orig = (existingItems ?? []).find((x) => x.id === d.existingId);
        if (!orig) continue;
        if (orig.ingredient_id !== d.ingredient_id || orig.quantity !== Number(d.quantity) || orig.unit !== d.unit) {
          const { error } = await supabase.from("recipe_items").update({
            ingredient_id: d.ingredient_id, quantity: Number(d.quantity), unit: d.unit,
          }).eq("id", d.existingId);
          if (error) { setBusy(false); return onError("Could not save an ingredient change."); }
        }
      }
      const toInsert = valid.filter((i) => !i.existingId);
      if (toInsert.length) {
        const { error } = await supabase.from("recipe_items").insert(
          toInsert.map((i) => ({ business_id: businessId, recipe_id: existing.id, ingredient_id: i.ingredient_id, quantity: Number(i.quantity), unit: i.unit })),
        );
        if (error) { setBusy(false); return onError("Could not add the new ingredients."); }
      }
      setBusy(false);
      onSaved(`${name.trim()} updated — now ${formatNaira(priceKobo)} per plate.`);
      return;
    }

    const { data: rec, error } = await supabase
      .from("recipes")
      .insert({
        business_id: businessId, name: name.trim(), category: category.trim() || null,
        yield_portions: Number(yieldPortions), selling_price_kobo: priceKobo,
      })
      .select("id")
      .single();
    if (error || !rec) { setBusy(false); return onError("Could not save recipe."); }
    const { error: itemsErr } = await supabase.from("recipe_items").insert(
      valid.map((i) => ({ business_id: businessId, recipe_id: rec.id, ingredient_id: i.ingredient_id, quantity: Number(i.quantity), unit: i.unit })),
    );
    setBusy(false);
    if (itemsErr) return onError("Recipe saved, but its ingredients could not be saved.");
    setName(""); setCategory(""); setYieldPortions("1"); setItems([]);
    setMarginPct(defaultPct); setOverride(false); setCustomPrice("");
    onSaved(`${name.trim()} saved at ${formatNaira(priceKobo)} per plate.`);
  }

  const showBelow = override && customPrice.trim() !== "" && defaultCost.errors.length === 0
    && defaultCost.suggested_price_kobo !== null
    && (isEdit ? nairaToKobo(customPrice) !== existing?.selling_price_kobo : true)
    && nairaToKobo(customPrice) < defaultCost.suggested_price_kobo;

  return (
    <form onSubmit={save} className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium text-card-foreground">{isEdit ? `Edit: ${existing?.name}` : "New recipe"}</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2"><Label htmlFor="r-name">Name</Label><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="r-cat">Category</Label><Input id="r-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Swallow, Rice…" /></div>
        <div className="grid gap-2"><Label htmlFor="r-yield">Plates it makes</Label><Input id="r-yield" inputMode="decimal" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value.replace(/[^\d.]/g, ""))} /></div>
      </div>

      <div className={`grid gap-2 ${override ? "opacity-50" : ""}`}>
        <div className="flex justify-between">
          <Label htmlFor="r-margin">Target margin</Label>
          <span className="text-sm font-medium text-foreground" data-testid="margin-pct">{marginPct}%</span>
        </div>
        <Slider id="r-margin" aria-label="Target margin" min={0} max={90} step={1} value={[marginPct]} disabled={override} onValueChange={(v) => setMarginPct(v[0] ?? 0)} />
      </div>

      <div className="grid gap-2">
        <Label>Ingredients</Label>
        {items.map((it) => {
          const line = cost.lines.find((l) => l.ingredient_id === it.ingredient_id && l.unit === it.unit && l.quantity === Number(it.quantity));
          const cannotRemove = !!it.existingId && !canDeleteItems;
          return (
            <div key={it.key} className="grid grid-cols-[1fr_5rem_8rem_auto] items-center gap-2">
              <Select value={it.ingredient_id} onValueChange={(v) => update(it.key, { ingredient_id: v, unit: ingredients.find((i) => i.id === v)?.base_unit ?? "" })}>
                <SelectTrigger aria-label="Ingredient"><SelectValue placeholder="Ingredient" /></SelectTrigger>
                <SelectContent>{ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label="Quantity" inputMode="decimal" value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value.replace(/[^\d.]/g, "") })} />
              <Select value={it.unit} onValueChange={(v) => update(it.key, { unit: v })} disabled={!it.ingredient_id}>
                <SelectTrigger aria-label="Unit"><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>
                  {(it.ingredient_id ? unitsFor(it.ingredient_id) : [...BASE_UNITS]).map((u) => (
                    <SelectItem key={u} value={u}>{u.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <span className="w-24 text-right text-sm text-muted-foreground">{line ? formatNaira(line.line_cost_kobo === null ? null : Math.round(line.line_cost_kobo)) : ""}</span>
                {cannotRemove
                  ? <span className="w-6 text-center text-xs text-muted-foreground" title="Only an owner can remove a saved ingredient">🔒</span>
                  : <button type="button" aria-label="Remove ingredient" className="text-sm text-muted-foreground underline" onClick={() => removeItem(it)}>✕</button>}
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => { setItems((xs) => [...xs, { key: nextKey, ingredient_id: "", quantity: "", unit: "" }]); setNextKey((k) => k + 1); }}>
          + Add ingredient
        </Button>
        {!canDeleteItems && <p className="text-xs text-muted-foreground">Only an owner can remove ingredients that are already saved.</p>}
      </div>

      <div className="grid gap-1 rounded-md bg-muted p-3 text-sm">
        <Row label="Total ingredient cost" value={formatNaira(Math.round(cost.total_ingredient_cost_kobo))} />
        <Row label="Cost per plate" value={formatNaira(cost.cost_per_plate_kobo)} />
        {cost.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
      </div>

      <div className="grid gap-3 rounded-md border border-border p-3">
        <div className="grid gap-1">
          <span className="text-sm text-muted-foreground">Selling price per plate (auto)</span>
          <output aria-label="Selling price per plate (auto)" className="text-2xl font-semibold text-foreground">
            {cost.errors.length ? "—" : formatNaira(cost.suggested_price_kobo)}
          </output>
          <span className="text-xs text-muted-foreground">at {marginPct}% margin</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="r-override" checked={override} onCheckedChange={toggleOverride} />
          <Label htmlFor="r-override">{isEdit ? "Keep a fixed price" : "Override price"}</Label>
        </div>
        {override && (
          <div className="grid gap-2">
            <Label htmlFor="r-custom">Selling price (₦)</Label>
            <Input id="r-custom" inputMode="decimal" value={customPrice} onChange={(e) => { setCustomPrice(e.target.value.replace(/[^\d.]/g, "")); setPriceError(null); }} />
            {priceError && <p className="text-xs text-destructive">{priceError}</p>}
            {showBelow && (
              <p className="text-xs text-destructive">
                Your selling price is below the suggested price ({formatNaira(defaultCost.suggested_price_kobo)} at {marginBps / 100}% margin).
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isEdit ? "Save changes" : "Save recipe"}</Button>
        {isEdit && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground"}>{value}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
