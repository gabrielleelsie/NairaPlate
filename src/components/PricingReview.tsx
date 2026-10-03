import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { computeRecipeCost, formatNaira, type CostIngredient, type CostConversion, type CostRecipeItem } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CORRECTION_COLUMNS, PRICE_DECISION_LABEL, canReverse, friendlyReversalError, pairReversals, priceReversalNote, reasonOk, type Correctable } from "@/lib/corrections";

type Recipe = { id: string; name: string; yield_portions: number; selling_price_kobo: number; cost_grade?: string | null };
type Decision = Correctable & {
  id: string; recipe_id: string | null; previous_price_kobo: number | null;
  suggested_price_kobo: number | null; decision: string | null; decided_by: string | null; created_at: string;
};
type DecisionKind = "publish" | "adjust_portion" | "defer";

/** Flag when the suggested price differs from the saved price by more than 2%. */
export const PRICE_REVIEW_THRESHOLD = 0.02;
export function needsPriceReview(selling_kobo: number, suggested_kobo: number): boolean {
  if (selling_kobo <= 0) return suggested_kobo > 0;
  return Math.abs(suggested_kobo - selling_kobo) / selling_kobo > PRICE_REVIEW_THRESHOLD;
}

const LABEL = PRICE_DECISION_LABEL;

export function PricingReview({
  businessId, userId, recipes, recipeItems, ingredients, conversions, marginBps, onAdjust, onChanged,
}: {
  businessId: string; userId: string; recipes: Recipe[]; recipeItems: (CostRecipeItem & { recipe_id: string })[];
  ingredients: CostIngredient[]; conversions: CostConversion[]; marginBps: number;
  onAdjust: (recipeId: string) => void; onChanged: () => void;
}) {
  const [history, setHistory] = useState<Decision[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  // Every version of every dish (old versions included), so a decision made on an old version
  // is still listed under the dish's name instead of "Deleted recipe".
  const [versions, setVersions] = useState<Record<string, { name: string; version_number: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    const [d, s, v] = await Promise.all([
      supabase.from("price_decisions").select(`*,${CORRECTION_COLUMNS}`).eq("business_id", businessId).order("created_at", { ascending: false }),
      supabase.from("staff_users").select("id,display_name").eq("business_id", businessId),
      supabase.from("recipes").select("id,name,version_number").eq("business_id", businessId),
    ]);
    if (d.error) return setMsg({ ok: false, text: "Could not load price decisions." });
    setHistory((d.data ?? []).map((r) => ({
      ...r,
      previous_price_kobo: r.previous_price_kobo === null ? null : Number(r.previous_price_kobo),
      suggested_price_kobo: r.suggested_price_kobo === null ? null : Number(r.suggested_price_kobo),
    })));
    setStaffNames(Object.fromEntries((s.data ?? []).map((x) => [x.id, x.display_name])));
    setVersions(Object.fromEntries(((v.data ?? []) as { id: string; name: string; version_number: number }[])
      .map((x) => [x.id, { name: x.name, version_number: Number(x.version_number ?? 1) }])));
  }, [businessId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Live check with the ONE costing function.
  const flagged = recipes.flatMap((r) => {
    const cost = computeRecipeCost({
      items: recipeItems.filter((i) => i.recipe_id === r.id),
      ingredients, conversions, yield_portions: r.yield_portions, target_margin_bps: marginBps, grade: r.cost_grade ?? null,
    });
    if (cost.errors.length || cost.suggested_price_kobo === null) return [];
    if (!needsPriceReview(r.selling_price_kobo, cost.suggested_price_kobo)) return [];
    return [{ recipe: r, suggested: cost.suggested_price_kobo }];
  });

  async function decide(r: Recipe, suggested: number, kind: DecisionKind) {
    setBusy(r.id); setMsg(null);
    // ONE database call: price change (publish only) + decision record in a single transaction.
    // The database reads the real "previous" price itself; if anything fails, nothing is saved.
    const { data, error } = await supabase.rpc("decide_price", {
      p_recipe_id: r.id, p_decision: kind, p_suggested_price_kobo: suggested, p_decided_by: userId,
    });
    setBusy(null);
    const previous = data ? Number((data as { previous_price_kobo: number }).previous_price_kobo) : r.selling_price_kobo;
    if (error) setMsg({ ok: false, text: `Nothing was saved — the price was not changed. (${error.message})` });
    else setMsg({ ok: true, text:
      kind === "publish" ? `${r.name}: price changed ${formatNaira(previous)} → ${formatNaira(suggested)}.`
      : kind === "defer" ? `${r.name}: deferred, price left at ${formatNaira(previous)}.`
      : `${r.name}: change the quantities or plates in the editor above.` });
    if (error) return;
    loadHistory();
    onChanged();
    if (kind === "adjust_portion") onAdjust(r.id);
  }

  async function reverse(d: Decision) {
    if (!reasonOk(reverseReason)) return;
    setBusy(d.id); setMsg(null);
    const { data, error } = await supabase.rpc("reverse_price_decision" as never, { p_decision_id: d.id, p_reason: reverseReason.trim() } as never);
    setBusy(null);
    if (error) return setMsg({ ok: false, text: friendlyReversalError(error.message) });
    const r = data as { price_restored?: boolean; price_kobo?: number | null } | null;
    setMsg({ ok: true, text: r?.price_restored && r.price_kobo != null ? `Decision reversed. The dish price is back to ${formatNaira(Number(r.price_kobo))}.` : "Decision reversed. No price was changed." });
    setReverseFor(null); setReverseReason("");
    loadHistory(); onChanged();
  }

  // Group history by dish name, so all versions of one dish appear together. Reversal rows are shown with the decision they reverse.
  const byRecipe = pairReversals(history).reduce<Record<string, ReturnType<typeof pairReversals<Decision>>>>((acc, d) => {
    const k = (d.recipe_id && versions[d.recipe_id]?.name) || "Deleted recipe"; (acc[k] ??= []).push(d); return acc;
  }, {});

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium text-foreground">Pricing review</h2>
      <p className="mt-1 text-xs text-muted-foreground">Dishes whose suggested price is more than 2% away from what you charge.</p>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>}
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {flagged.length === 0 && <li className="p-4 text-sm text-muted-foreground">All prices are within 2% of the suggestion.</li>}
        {flagged.map(({ recipe: r, suggested }) => {
          const pct = r.selling_price_kobo > 0 ? ((suggested - r.selling_price_kobo) / r.selling_price_kobo) * 100 : 0;
          return (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <div className="font-medium text-foreground">{r.name}</div>
                <div className="text-right">
                  <div className="text-foreground">Now {formatNaira(r.selling_price_kobo)}</div>
                  <div className={pct > 0 ? "text-destructive" : "text-muted-foreground"}>
                    Suggested {formatNaira(suggested)} ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, suggested, "publish")}>Publish {formatNaira(suggested)}</Button>
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r, suggested, "adjust_portion")}>Adjust portion</Button>
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decide(r, suggested, "defer")}>Defer</Button>
              </div>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-8 font-medium text-foreground">Price decision history</h3>
      {pairReversals(history).length === 0 && <p className="mt-2 text-sm text-muted-foreground">No decisions yet.</p>}
      {Object.entries(byRecipe).map(([dish, rows]) => (
        <div key={dish} className="mt-3 rounded-lg border border-border p-3">
          <div className="text-sm font-medium text-foreground">{dish}</div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {rows.map((d) => (
              <li key={d.id} className={d.reversed ? "opacity-60" : ""}>
                {new Date(d.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {LABEL[d.decision ?? ""] ?? d.decision}{d.reversed ? " (Reversed)" : ""} ·
                {d.recipe_id && versions[d.recipe_id] ? ` version ${versions[d.recipe_id]!.version_number} · ` : " "}
                was {d.previous_price_kobo === null ? "—" : formatNaira(d.previous_price_kobo)}, suggested {d.suggested_price_kobo === null ? "—" : formatNaira(d.suggested_price_kobo)}
                {d.decided_by ? ` · by ${staffNames[d.decided_by] ?? "staff"}` : ""}
                {d.reversed && <div>Reversed{d.reversedBy ? ` by ${d.reversedBy}` : ""}: {d.reversalReason}</div>}
                {canReverse("owner", d) && (reverseFor === d.id ? (
                  <div className="mt-1 space-y-2 rounded-md bg-muted p-2">
                    <p>{priceReversalNote(d, formatNaira)}</p>
                    <Input aria-label="Reason (at least 5 characters)" placeholder="Reason (at least 5 characters)" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busy === d.id || !reasonOk(reverseReason)} onClick={() => reverse(d)}>Reverse this decision</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : <Button className="mt-1" size="sm" variant="outline" onClick={() => { setReverseFor(d.id); setReverseReason(""); setMsg(null); }}>Reverse</Button>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
