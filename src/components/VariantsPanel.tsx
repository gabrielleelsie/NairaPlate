import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/external-supabase";
import { formatNaira, type CostConversion, type CostIngredient } from "@/lib/costing";
import { marketUnitLabel } from "@/lib/staff-session";
import { MAX_LABEL, MAX_VARIANTS, compareVariants, labelProblem, type RecipeVariant, type VariantItem } from "@/lib/variants";

type Saved = { name: string; category: string | null; yield_portions: number; selling_price_kobo: number; cost_grade: string | null; id: string; dish_id: string };

// Owner only. Variants are saved ingredient lists for this dish. Nothing about the dish changes until "Use this one",
// which saves a normal new recipe version, so past sales keep their old cost.
export function VariantsPanel({
  dish, savedItems, draftItems, variants, ingredients, conversions, onChanged, onSwitched, onError, resetDraft,
}: {
  dish: Saved; savedItems: VariantItem[]; draftItems: VariantItem[]; variants: RecipeVariant[];
  ingredients: CostIngredient[]; conversions: CostConversion[];
  onChanged: () => void; onSwitched: (text: string) => void; onError: (text: string) => void; resetDraft: () => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const mine = useMemo(() => variants.filter((v) => v.dish_id === dish.dish_id), [variants, dish.dish_id]);
  const name = (id: string) => ingredients.find((i) => i.id === id)?.name ?? "Ingredient";

  const cmp = useMemo(() => compareVariants({
    current: { items: savedItems, yield_portions: dish.yield_portions }, price_kobo: dish.selling_price_kobo, grade: dish.cost_grade,
    variants: mine, ingredients, conversions,
  }), [savedItems, dish, mine, ingredients, conversions]);

  const newProblem = label.trim() === "" ? null : labelProblem(label, mine);
  const draftDiffers = JSON.stringify(draftItems.map((i) => [i.ingredient_id, i.quantity, i.unit]).sort()) !== JSON.stringify(savedItems.map((i) => [i.ingredient_id, i.quantity, i.unit]).sort());

  async function save(variantId: string | null, lbl: string, items: VariantItem[], yieldPortions: number, okText: string) {
    setBusy(variantId ?? "new");
    const { error } = await supabase.rpc("save_recipe_variant" as never, {
      p_dish_id: dish.dish_id, p_variant_id: variantId, p_label: lbl.trim(), p_yield_portions: yieldPortions,
      p_items: items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity, unit: i.unit, min_quantity: i.min_quantity ?? null, never_cut: !!i.never_cut })),
    } as never);
    setBusy(null);
    if (error) return onError(`Not saved: ${error.message}`);
    onChanged();
    return okText;
  }

  async function addFromDraft() {
    if (labelProblem(label, mine)) return;
    const ok = await save(null, label, draftItems, dish.yield_portions, "");
    if (ok !== undefined) { setLabel(""); resetDraft(); }
  }

  async function remove(v: RecipeVariant) {
    if (!confirm(`Delete the variant "${v.label}"? The dish and its history are not affected.`)) return;
    setBusy(v.id);
    const { error } = await supabase.rpc("delete_recipe_variant" as never, { p_variant_id: v.id } as never);
    setBusy(null);
    if (error) return onError(`Not deleted: ${error.message}`);
    onChanged();
  }

  async function use(v: RecipeVariant) {
    const unsaved = cmp.current_matches === null;
    const msg = `Switch ${dish.name} to "${v.label}"? This saves a new version of the dish with that ingredient list. Past sales keep their old cost.`
      + (unsaved ? `\n\nThe dish as it is now is not saved as a variant. It stays in the dish's version history, but you will not be able to switch back with one tap.` : "");
    if (!confirm(msg)) return;
    setBusy(v.id);
    const { data, error } = await supabase.rpc("save_recipe_version" as never, {
      p_recipe_id: dish.id, p_name: dish.name, p_category: dish.category, p_yield_portions: v.yield_portions,
      p_selling_price_kobo: dish.selling_price_kobo,
      p_items: v.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity, unit: i.unit, min_quantity: i.min_quantity ?? null, never_cut: !!i.never_cut })),
      p_cost_grade: dish.cost_grade,
    } as never);
    setBusy(null);
    if (error) return onError(`Nothing was changed, the dish is as it was. (${error.message})`);
    const ver = (data as { version_number?: number } | null)?.version_number;
    onSwitched(`${dish.name} now uses "${v.label}", saved as version ${ver ?? "new"} at ${formatNaira(dish.selling_price_kobo)} a plate. Past sales keep the old cost.`);
  }

  async function rename() {
    if (!renaming) return;
    const v = mine.find((x) => x.id === renaming.id);
    if (!v || labelProblem(renaming.label, mine, v.id)) return;
    const ok = await save(v.id, renaming.label, v.items, v.yield_portions, "");
    if (ok !== undefined) setRenaming(null);
  }

  const costText = (c: number | null, m: number | null) => (c === null ? "can't be costed" : `${formatNaira(c)} a plate${m !== null ? `, ${m.toFixed(0)}% margin` : ""}`);

  return (
    <div className="grid gap-3 rounded-md border border-border p-3" data-testid="variants-panel">
      <div>
        <div className="text-sm font-medium text-foreground">Variants of this dish</div>
        <p className="text-xs text-muted-foreground">
          Save different ingredient lists, such as "Standard" and "Lean season", and compare what each costs at today's prices{dish.cost_grade ? ` and grade ${dish.cost_grade}` : ""}.
          Saving a variant does not change the dish. Only an owner can switch.
        </p>
      </div>

      <div className="rounded-md bg-muted p-2 text-sm">
        <span className="font-medium text-foreground">Now: </span>
        <span className="text-foreground">{cmp.current.error ?? costText(cmp.current.cost_per_plate_kobo, cmp.current.margin_pct)}</span>
        <span className="text-xs text-muted-foreground"> {cmp.current_matches ? `(this is "${cmp.current_matches}")` : "(not saved as a variant)"}</span>
      </div>

      {mine.length === 0 && <p className="text-xs text-muted-foreground">No variants yet.</p>}
      <ul className="grid gap-2">
        {mine.map((v) => {
          const row = cmp.rows.find((r) => r.id === v.id)!;
          const diff = row.cost_diff_kobo;
          return (
            <li key={v.id} className="rounded-md border border-border p-2 text-sm" data-testid="variant-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {renaming?.id === v.id ? (
                  <span className="flex items-center gap-1">
                    <Input aria-label="Variant name" className="h-8 w-44" maxLength={MAX_LABEL} value={renaming.label} onChange={(e) => setRenaming({ id: v.id, label: e.target.value })} />
                    <Button type="button" size="sm" disabled={!!labelProblem(renaming.label, mine, v.id) || busy !== null} onClick={rename}>Save name</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </span>
                ) : <span className="font-medium text-foreground">{v.label}{row.active ? " (in use)" : ""}</span>}
                <span className="text-muted-foreground">{row.error ?? costText(row.cost_per_plate_kobo, row.margin_pct)}</span>
              </div>
              {diff !== null && !row.active && (
                <p className={`text-xs ${diff < 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  {diff === 0 ? "Costs the same as now." : `${formatNaira(Math.abs(diff))} a plate ${diff < 0 ? "cheaper" : "dearer"} than now.`}
                </p>
              )}
              {row.fallbacks.length > 0 && dish.cost_grade && <p className="text-xs text-muted-foreground">No grade {dish.cost_grade} price yet for {row.fallbacks.join(", ")}, so the latest price is used.</p>}
              <p className="text-xs text-muted-foreground">{v.items.map((i) => `${name(i.ingredient_id)} ${i.quantity} ${marketUnitLabel(i.unit)}`).join(", ")}{v.yield_portions !== 1 ? ` (makes ${v.yield_portions} plates)` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {!row.active && <Button type="button" size="sm" disabled={busy !== null || !!row.error} onClick={() => use(v)}>{busy === v.id ? "Switching…" : "Use this one"}</Button>}
                <Button type="button" size="sm" variant="outline" disabled={busy !== null || !draftDiffers} title={draftDiffers ? undefined : "Change the ingredient lines in the form above first"}
                  onClick={async () => { if (confirm(`Replace the ingredient list of "${v.label}" with the lines now in the form?`)) { const ok = await save(v.id, v.label, draftItems, dish.yield_portions, ""); if (ok !== undefined) resetDraft(); } }}>
                  Replace with the form's lines
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRenaming({ id: v.id, label: v.label })}>Rename</Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={() => remove(v)}>Delete</Button>
              </div>
            </li>
          );
        })}
      </ul>

      {mine.length < MAX_VARIANTS && (
        <div className="grid gap-1">
          <Label htmlFor="variant-label">Save the ingredient lines in the form above as a new variant</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="variant-label" className="h-9 w-56" maxLength={MAX_LABEL} placeholder="e.g. Lean season" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button type="button" size="sm" disabled={busy !== null || label.trim() === "" || !!newProblem} onClick={addFromDraft}>{busy === "new" ? "Saving…" : "Save as variant"}</Button>
          </div>
          {newProblem && <span className="text-xs text-destructive">{newProblem}</span>}
          <span className="text-xs text-muted-foreground">
            {draftDiffers ? "The form's lines differ from the saved dish, so this saves your edits as the variant. The dish itself stays as it is, and the form goes back to the saved dish."
              : "To make a lean version, first change the quantities in the form above, then save it here. You can also save the dish as it is now, so you can switch back to it."}
          </span>
        </div>
      )}
    </div>
  );
}
