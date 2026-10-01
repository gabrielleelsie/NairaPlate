import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatNaira, type CostConversion, type CostIngredient, type CostRecipeItem } from "@/lib/costing";
import { marketUnitLabel } from "@/lib/staff-session";
import { driftByCost, suggestMinimums, trimToTarget, SUGGESTED_MINIMUM_SHARE, type HoldLine, type Proposal } from "@/lib/hold-price";

export type HoldDraft = { key: number; ingredient_id: string; quantity: string; unit: string; min?: string | undefined; neverCut?: boolean | undefined };

// "Hold my price": the dish is under its target margin and the owner wants to keep the price. Shows how far
// ingredient quantities can come down within the owner's minimums. Nothing is saved here: "Use these quantities"
// only fills the form, and saving the recipe creates a new version as usual.
export function HoldPricePanel({
  items, setItems, ingredients, conversions, yieldPortions, priceKobo, marginBps, grade, original,
}: {
  items: HoldDraft[]; setItems: React.Dispatch<React.SetStateAction<(HoldDraft & { existingId?: string })[]>>;
  ingredients: CostIngredient[]; conversions: CostConversion[]; yieldPortions: number; priceKobo: number;
  marginBps: number; grade: string | null; original: { items: CostRecipeItem[]; yield_portions: number } | null;
}) {
  const [undo, setUndo] = useState<Map<number, string> | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof trimToTarget> | null>(null);
  const name = (id: string) => ingredients.find((i) => i.id === id)?.name ?? "Ingredient";

  const holdLines: HoldLine[] = useMemo(
    () => items.filter((i) => i.ingredient_id && Number(i.quantity) > 0).map((i) => ({
      key: i.key, ingredient_id: i.ingredient_id, quantity: Number(i.quantity), unit: i.unit,
      min_quantity: i.min && Number(i.min) >= 0 && i.min.trim() !== "" ? Number(i.min) : null, never_cut: !!i.neverCut,
    })),
    [items],
  );

  const drift = useMemo(
    () => driftByCost({
      original, current: { items: holdLines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: l.quantity, unit: l.unit })), yield_portions: yieldPortions },
      ingredients, conversions, grade,
    }),
    [original, holdLines, yieldPortions, ingredients, conversions, grade],
  );

  const patch = (key: number, p: Partial<HoldDraft>) => { setPreview(null); setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))); };
  const anyMin = holdLines.some((l) => l.min_quantity !== null && !l.never_cut);

  function suggest() {
    const m = suggestMinimums(holdLines);
    setPreview(null);
    setItems((xs) => xs.map((x) => (m.has(x.key) ? { ...x, min: String(m.get(x.key)) } : x)));
  }
  function trim() {
    setPreview(trimToTarget({ lines: holdLines, ingredients, conversions, yield_portions: yieldPortions, price_kobo: priceKobo, target_margin_bps: marginBps, grade }));
  }
  function apply(proposals: Proposal[]) {
    setUndo(new Map(items.map((i) => [i.key, i.quantity])));
    const to = new Map(proposals.map((p) => [p.key, String(p.to)]));
    setItems((xs) => xs.map((x) => (to.has(x.key) ? { ...x, quantity: to.get(x.key)! } : x)));
    setPreview(null);
  }
  function revert() {
    if (!undo) return;
    setItems((xs) => xs.map((x) => (undo.has(x.key) ? { ...x, quantity: undo.get(x.key)! } : x)));
    setUndo(null);
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3" data-testid="hold-price-panel">
      <div>
        <div className="text-sm font-medium text-foreground">Hold my price</div>
        <p className="text-xs text-muted-foreground">
          Keep the price at {formatNaira(priceKobo)} and bring the cost down by trimming ingredients, never below the minimum you set for each one.
          Lines with no minimum are not touched.
        </p>
      </div>

      <div className="grid gap-2">
        {holdLines.map((l) => (
          <div key={l.key} className="grid grid-cols-[1fr_auto_6rem] items-center gap-2 text-sm">
            <span className="text-foreground">{name(l.ingredient_id)} <span className="text-muted-foreground">{l.quantity} {marketUnitLabel(l.unit)}</span></span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={l.never_cut} onChange={(e) => patch(l.key, { neverCut: e.target.checked })} /> Never cut
            </label>
            <input
              aria-label={`Minimum ${name(l.ingredient_id)}`} inputMode="decimal" placeholder="Minimum" disabled={l.never_cut}
              className="h-8 rounded-md border border-input bg-background px-2 text-right text-sm disabled:opacity-40"
              value={items.find((i) => i.key === l.key)?.min ?? ""} onChange={(e) => patch(l.key, { min: e.target.value.replace(/[^\d.]/g, "") })}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={suggest}>Suggest minimums ({Math.round(SUGGESTED_MINIMUM_SHARE * 100)}% of today's amount)</Button>
        <Button type="button" size="sm" disabled={!anyMin} onClick={trim} title={anyMin ? undefined : "Set a minimum on at least one ingredient first"}>Trim to hold my price</Button>
        {undo && <Button type="button" variant="ghost" size="sm" onClick={revert}>Undo the trim</Button>}
      </div>
      {!anyMin && <p className="text-xs text-muted-foreground">Set a minimum on at least one ingredient, or tap "Suggest minimums" and edit them.</p>}

      {preview && (
        <div className="grid gap-1 rounded-md bg-muted p-3 text-sm" data-testid="hold-price-preview">
          {preview.error ? <p className="text-destructive">{preview.error}</p> : preview.proposals.length === 0 && preview.reached ? (
            <p className="text-foreground">This dish is already on target. Nothing to trim.</p>
          ) : (
            <>
              {preview.proposals.map((p) => (
                <p key={p.key} className="text-foreground">{name(p.ingredient_id)}: {p.from} to {p.to} {marketUnitLabel(p.unit)} ({(((p.to - p.from) / p.from) * 100).toFixed(0)}%)</p>
              ))}
              <p className="mt-1 text-foreground">
                Cost per plate {formatNaira(preview.before.cost_per_plate_kobo)} to {formatNaira(preview.after.cost_per_plate_kobo)}.
                Margin {preview.before.margin_pct.toFixed(0)}% to {preview.after.margin_pct.toFixed(0)}% (target {preview.target_pct.toFixed(0)}%).
              </p>
              {!preview.reached && (
                <p className="text-destructive">Your minimums only get you part of the way. The cost is still about {formatNaira(preview.shortfall_per_plate_kobo)} a plate above what your target allows. Lower a minimum, or consider a cheaper grade or a price change.</p>
              )}
              {preview.proposals.length > 0 && <Button type="button" size="sm" className="mt-2 justify-self-start" onClick={() => apply(preview.proposals)}>Use these quantities</Button>}
              <p className="text-xs text-muted-foreground">This only fills the form. Saving the recipe creates a new version, and past sales keep their old cost.</p>
            </>
          )}
        </div>
      )}

      {drift !== null && (
        <p className="text-xs text-muted-foreground" data-testid="hold-price-drift">
          Compared with your first version of this dish, the ingredients per plate cost {Math.abs(drift) < 0.5 ? "about the same" : `${Math.abs(drift).toFixed(0)}% ${drift < 0 ? "less" : "more"}`} at today's prices
          {drift < -0.5 ? ", so the plate is lighter" : ""}.
        </p>
      )}
    </div>
  );
}
