import { SEASONS, seasonLabel } from "@/lib/season";
import { GRADES, gradeLabel } from "@/lib/grade";
import { gradeSeasonProblem, needsGradeAndSeason } from "@/lib/ingredient-price";
import { reasonLabel as stockReasonLabel } from "@/lib/stock";
import { describePurchases, normalisePurchases, type PurchaseView } from "@/lib/purchases";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, MARKET_UNIT_OPTIONS, BASE_UNITS, marketUnitLabel } from "@/lib/staff-session";
import { TRIAL_LIMITS, isTrialPlan, trialLimitMessage, trialUsage, useBusinessPlan } from "@/lib/trial-limits";
import { formatNaira, nairaToKobo, koboToNaira } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/ingredients")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ingredients — NairaPlate" },
      { name: "description", content: "Ingredient prices, stock thresholds and market-unit conversions for your kitchen." },
      { property: "og:title", content: "Ingredients — NairaPlate" },
      { property: "og:description", content: "Ingredient prices, stock thresholds and market-unit conversions for your kitchen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngredientsScreen,
});

type Ingredient = {
  id: string; name: string; category: string | null; base_unit: string;
  current_cost_kobo: number; previous_cost_kobo: number; min_threshold_qty: number; supplier: string | null;
  stock_base_qty: number; price_updated_at: string | null; current_grade: string | null; current_season: string | null;
};

function formatPriceDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
type Conversion = { id: string; ingredient_id: string; market_unit: string; base_qty: number };
type Purchase = { id: string; ingredient_id: string; qty: number; market_unit: string; total_kobo: number; payment_method: string | null; recorded_at: string; grade: string | null; season: string | null; kind?: "purchase" | "reversal"; reverses_id?: string | null; reason?: string | null };

const EDIT_ROLES = new Set(["owner", "supa_admin", "purchaser"]);

function IngredientsScreen() {
  const { loading, session } = useStaffSession();
  const [items, setItems] = useState<Ingredient[]>([]);
  const [convs, setConvs] = useState<Conversion[]>([]);
  const [editing, setEditing] = useState<Ingredient | "new" | null>(null);
  const [unitsFor, setUnitsFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [trailFor, setTrailFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from("ingredients").select("id,name,category,base_unit,current_cost_kobo,previous_cost_kobo,min_threshold_qty,supplier,stock_base_qty,price_updated_at,current_grade,current_season").order("name"),
      supabase.from("unit_conversions").select("id,ingredient_id,market_unit,base_qty").order("market_unit"),
    ]);
    if (a.error || b.error) return setMsg({ ok: false, text: "Could not load ingredients." });
    setItems((a.data ?? []) as Ingredient[]);
    setConvs((b.data ?? []) as Conversion[]);
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);
  const plan = useBusinessPlan(!!session);
  const onTrial = isTrialPlan(plan);
  const atIngredientLimit = onTrial && items.length >= TRIAL_LIMITS.ingredientsTotal;

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/app" className="underline text-sm">Go to sign-in</Link></Shell>;
  const canEdit = EDIT_ROLES.has(session.role);

  return (
    <Shell>
      <Link to="/app" className="text-sm text-muted-foreground underline">← Home</Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-foreground">Ingredients</h1>
        {canEdit && <Button onClick={() => setEditing("new")} disabled={atIngredientLimit}>Add ingredient</Button>}
      </div>
      {onTrial && (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="trial-ingredient-usage">
          Free trial: {trialUsage(items.length, TRIAL_LIMITS.ingredientsTotal, "ingredients")}.
          {atIngredientLimit ? " Choose a plan to add more." : ""}
        </p>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>}

      {editing && (
        <IngredientForm
          businessId={session.businessId}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(t) => { setEditing(null); setMsg({ ok: true, text: t }); load(); }}
          onError={(t) => setMsg({ ok: false, text: t })}
        />
      )}

      <ul className="mt-6 divide-y divide-border rounded-lg border border-border">
        {items.length === 0 && <li className="p-4 text-sm text-muted-foreground">No ingredients yet.</li>}
        {items.map((i) => (
          <li key={i.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">{i.name}</div>
                <div className="text-sm text-muted-foreground">
                  {formatNaira(i.current_cost_kobo)} per {i.base_unit}{i.current_grade && <> (grade {i.current_grade}{i.current_season ? `, ${seasonLabel(i.current_season).toLowerCase()}` : ""})</>}
                  {i.previous_cost_kobo > 0 && i.previous_cost_kobo !== i.current_cost_kobo && (
                    <> · was {formatNaira(i.previous_cost_kobo)}</>
                  )}
                  {formatPriceDate(i.price_updated_at) && (
                    <> · price updated {formatPriceDate(i.price_updated_at)}</>
                  )}
                </div>
                <div className={Number(i.stock_base_qty) < 0 ? "text-sm font-semibold text-destructive" : "text-sm"} data-testid="stock">
                  In stock: {Number(Number(i.stock_base_qty).toFixed(3))} {i.base_unit}
                  {Number(i.stock_base_qty) < 0 && " (below zero, stock count is off)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[i.category, i.supplier && `from ${i.supplier}`, `reorder below ${i.min_threshold_qty} ${i.base_unit}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setUnitsFor(unitsFor === i.id ? null : i.id)}>
                  Units ({convs.filter((c) => c.ingredient_id === i.id).length})
                </Button>
                <Button size="sm" variant="outline" onClick={() => setHistoryFor(historyFor === i.id ? null : i.id)}>
                  History
                </Button>
                {canEdit && <Button size="sm" variant="outline" onClick={() => setTrailFor(trailFor === i.id ? null : i.id)}>Stock trail</Button>}
                {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(i)}>Edit</Button>}
              </div>
            </div>
            {unitsFor === i.id && (
              <ConversionsPanel
                ingredient={i}
                businessId={session.businessId}
                conversions={convs.filter((c) => c.ingredient_id === i.id)}
                canEdit={canEdit}
                canDelete={session.role === "owner" || session.role === "supa_admin"}
                onChanged={load}
                onError={(t) => setMsg({ ok: false, text: t })}
              />
            )}
            {historyFor === i.id && <PriceHistoryPanel ingredient={i} />}
            {trailFor === i.id && <StockTrailPanel ingredient={i} />}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function IngredientForm({
  businessId, initial, onCancel, onSaved, onError,
}: {
  businessId: string; initial: Ingredient | null;
  onCancel: () => void; onSaved: (t: string) => void; onError: (t: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [baseUnit, setBaseUnit] = useState(initial?.base_unit ?? "kg");
  const [cost, setCost] = useState(initial ? koboToNaira(initial.current_cost_kobo) : "");
  const [minQty, setMinQty] = useState(initial ? String(initial.min_threshold_qty) : "0");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [grade, setGrade] = useState("");
  const [season, setSeason] = useState(initial?.current_season ?? "");
  const [gradePrices, setGradePrices] = useState<{ grade: string; cost_kobo: number; season: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    supabase.from("ingredient_grade_prices").select("grade,cost_kobo,season").eq("ingredient_id", initial.id).order("grade")
      .then(({ data }) => { if (!cancelled) setGradePrices((data ?? []).map((r) => ({ grade: String(r.grade), cost_kobo: Number(r.cost_kobo), season: r.season ? String(r.season) : null }))); });
    return () => { cancelled = true; };
  }, [initial]);

  const newCostKobo = nairaToKobo(cost);
  const askGradeSeason = needsGradeAndSeason({ isNew: !initial, savedKobo: initial ? Number(initial.current_cost_kobo) : null, newKobo: Number.isFinite(newCostKobo) ? newCostKobo : 0 });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return onError("Name is required.");
    const newCost = nairaToKobo(cost);
    if (!(newCost >= 0)) return onError("Enter a valid price.");
    if (needsGradeAndSeason({ isNew: !initial, savedKobo: initial ? Number(initial.current_cost_kobo) : null, newKobo: newCost })) {
      const problem = gradeSeasonProblem(grade, season);
      if (problem) return onError(problem);
    }
    setBusy(true);
    const fields = {
      name: name.trim(), category: category.trim() || null, base_unit: baseUnit,
      min_threshold_qty: Number(minQty) || 0, supplier: supplier.trim() || null,
    };
    if (!initial) {
      const { data: created, error } = await supabase.from("ingredients").insert({
        ...fields, business_id: businessId, current_cost_kobo: 0, previous_cost_kobo: 0, stock_base_qty: 0,
      }).select("id").single();
      if (error || !created) { setBusy(false); return onError(trialLimitMessage(error?.message ?? "") ?? "Could not add ingredient."); }
      if (newCost > 0) {
        const { error: priceErr } = await supabase.rpc("set_ingredient_price", { p_ingredient_id: created.id, p_price_kobo: newCost, p_grade: grade, p_season: season });
        setBusy(false);
        return priceErr ? onError(`${fields.name} was added, but its price was not saved: ${priceErr.message}`) : onSaved(`${fields.name} added at ${formatNaira(newCost)} (grade ${grade}, ${seasonLabel(season).toLowerCase()}).`);
      }
      setBusy(false);
      return onSaved(`${fields.name} added.`);
    }
    // Price change: read the price currently saved (not what the form loaded with),
    // and move it into previous_cost_kobo before writing the new one.
    const { data: live, error: readErr } = await supabase
      .from("ingredients").select("current_cost_kobo").eq("id", initial.id).single();
    if (readErr || !live) { setBusy(false); return onError("Could not read the current price."); }
    const priceChanged = Number(live.current_cost_kobo) !== newCost;
    const { error } = await supabase.from("ingredients").update(fields).eq("id", initial.id);
    if (error) { setBusy(false); return onError("Could not save ingredient."); }
    if (priceChanged && newCost > 0) {
      const { error: priceErr } = await supabase.rpc("set_ingredient_price", { p_ingredient_id: initial.id, p_price_kobo: newCost, p_grade: grade, p_season: season });
      setBusy(false);
      if (priceErr) return onError(`${fields.name} was saved, but the new price was not: ${priceErr.message}`);
      return onSaved(`${fields.name} saved. Price ${formatNaira(Number(live.current_cost_kobo))} → ${formatNaira(newCost)} (grade ${grade}, ${seasonLabel(season).toLowerCase()}).`);
    }
    setBusy(false);
    onSaved(`${fields.name} saved.`);
  }

  return (
    <form onSubmit={save} className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium text-card-foreground">{initial ? `Edit ${initial.name}` : "New ingredient"}</h2>
      <Field label="Name" id="ing-name"><Input id="ing-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" id="ing-cat"><Input id="ing-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Grains, Protein…" /></Field>
        <Field label="Base unit" id="ing-unit">
          <Select value={baseUnit} onValueChange={setBaseUnit}>
            <SelectTrigger id="ing-unit" aria-label="Base unit"><SelectValue /></SelectTrigger>
            <SelectContent>{BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Price per ${baseUnit} (₦)`} id="ing-cost">
          <Input id="ing-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label={`Reorder below (${baseUnit})`} id="ing-min">
          <Input id="ing-min" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
      </div>
      {initial && (initial.current_grade || gradePrices.length > 0) && (
        <p className="text-xs text-muted-foreground" data-testid="grade-prices">
          Current price is for grade {initial.current_grade ?? "?"}{initial.current_season ? `, ${seasonLabel(initial.current_season).toLowerCase()} season` : ""}.
          {gradePrices.length > 0 && <> Saved prices: {gradePrices.map((g) => `${gradeLabel(g.grade)} ${formatNaira(g.cost_kobo)}${g.season ? ` (${seasonLabel(g.season).toLowerCase()})` : ""}`).join(" · ")} per {baseUnit}.</>}
        </p>
      )}
      {askGradeSeason && (
        <div className="grid grid-cols-2 gap-3" data-testid="grade-season-fields">
          <Field label="Grade this price is for" id="ing-grade">
            <Select value={grade} onValueChange={setGrade}>
              <SelectTrigger id="ing-grade" aria-label="Grade"><SelectValue placeholder="Choose grade" /></SelectTrigger>
              <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={g}>{gradeLabel(g)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Season it was bought in" id="ing-season">
            <Select value={season} onValueChange={setSeason}>
              <SelectTrigger id="ing-season" aria-label="Season"><SelectValue placeholder="Choose season" /></SelectTrigger>
              <SelectContent>{SEASONS.map((x) => <SelectItem key={x} value={x}>{seasonLabel(x)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      )}
      <Field label="Supplier" id="ing-sup"><Input id="ing-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ConversionsPanel({
  ingredient, businessId, conversions, canEdit, canDelete, onChanged, onError,
}: {
  ingredient: Ingredient; businessId: string; conversions: Conversion[];
  canEdit: boolean; canDelete: boolean; onChanged: () => void; onError: (t: string) => void;
}) {
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const base_qty = Number(qty);
    if (!unit || !(base_qty > 0)) return onError("Pick a market unit and enter how much it holds.");
    setBusy(true);
    const existing = conversions.find((c) => c.market_unit === unit);
    const { error } = existing
      ? await supabase.from("unit_conversions").update({ base_qty }).eq("id", existing.id)
      : await supabase.from("unit_conversions").insert({ business_id: businessId, ingredient_id: ingredient.id, market_unit: unit, base_qty });
    setBusy(false);
    if (error) return onError("Could not save conversion.");
    setUnit(""); setQty(""); onChanged();
  }

  return (
    <div className="mt-3 rounded-md bg-muted p-3">
      <div className="text-sm font-medium text-foreground">Unit conversions for {ingredient.name}</div>
      <p className="text-xs text-muted-foreground">These only apply to {ingredient.name}. Other ingredients have their own.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {conversions.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        {conversions.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="text-foreground">1 {marketUnitLabel(c.market_unit)} = {Number(c.base_qty)} {ingredient.base_unit}</span>
            {canDelete && (
              <button
                className="text-xs text-muted-foreground underline"
                onClick={async () => {
                  const { error } = await supabase.from("unit_conversions").delete().eq("id", c.id);
                  if (error) onError("Could not remove conversion."); else onChanged();
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Market unit</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="w-40" aria-label="Market unit"><SelectValue placeholder="Pick" /></SelectTrigger>
              <SelectContent>{MARKET_UNIT_OPTIONS.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor={`q-${ingredient.id}`}>Holds ({ingredient.base_unit})</Label>
            <Input id={`q-${ingredient.id}`} className="w-28" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <Button type="submit" size="sm" disabled={busy}>Save unit</Button>
        </form>
      )}
    </div>
  );
}

function StockTrailPanel({ ingredient }: { ingredient: Ingredient }) {
  const [rows, setRows] = useState<{ id: string; qty_base: number; balance_after: number; reason: string; created_at: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from("stock_movements").select("id,qty_base,balance_after,reason,created_at").eq("ingredient_id", ingredient.id).order("created_at", { ascending: false }).limit(40)
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data ?? []).map((r) => ({ id: String(r.id), reason: String(r.reason), created_at: String(r.created_at), qty_base: Number(r.qty_base), balance_after: Number(r.balance_after) })));
      });
    return () => { cancelled = true; };
  }, [ingredient.id]);
  const n = (x: number) => Number(x.toFixed(3));
  return (
    <div className="mt-3 rounded-md bg-muted p-3" data-testid="stock-trail">
      <div className="text-sm font-medium text-foreground">Stock trail for {ingredient.name}</div>
      <p className="text-xs text-muted-foreground">Every change to the stock figure, newest first, with the reason and what was left after.</p>
      {rows === null ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-foreground">{stockReasonLabel(r.reason)}</span>
              <span className={r.qty_base < 0 ? "text-foreground" : "text-foreground"}>{r.qty_base > 0 ? "+" : ""}{n(r.qty_base)} {ingredient.base_unit} · left {n(r.balance_after)} <span className="text-xs text-muted-foreground">{formatPriceDate(r.created_at)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriceHistoryPanel({ ingredient }: { ingredient: Ingredient }) {
  const [rows, setRows] = useState<PurchaseView[] | null>(null);
  const [err, setErr] = useState(false);
  const [gf, setGf] = useState<string>("all");
  const [sf, setSf] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("purchases")
      .select("id,ingredient_id,qty,market_unit,total_kobo,payment_method,recorded_at,grade,season,kind,reverses_id,reason")
      .eq("ingredient_id", ingredient.id)
      .order("recorded_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(true);
        else setRows(describePurchases(normalisePurchases(data as unknown[])));
      });
    return () => { cancelled = true; };
  }, [ingredient.id]);

  return (
    <div className="mt-3 rounded-md bg-muted p-3">
      <div className="text-sm font-medium text-foreground">Price history for {ingredient.name}</div>
      <p className="text-xs text-muted-foreground">Every purchase logged, newest first. Prices are what you actually paid.</p>
      {err && <p className="mt-2 text-sm text-destructive">Could not load price history.</p>}
      {rows === null && !err && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">No purchases logged yet. Log one on the Log purchase screen.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="mt-2 flex gap-1" role="group" aria-label="Filter by grade">
          {["all", "A", "B", "C"].map((g) => (
            <button key={g} type="button" aria-pressed={gf === g} onClick={() => setGf(g)}
              className={"rounded-md border px-2 py-0.5 text-xs " + (gf === g ? "bg-primary text-primary-foreground" : "bg-background text-foreground")}>
              {g === "all" ? "All" : `Grade ${g}`}
            </button>
          ))}
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="mt-1 flex gap-1" role="group" aria-label="Filter by season">
          {["all", ...SEASONS].map((x) => (
            <button key={x} type="button" aria-pressed={sf === x} onClick={() => setSf(x)}
              className={"rounded-md border px-2 py-0.5 text-xs " + (sf === x ? "bg-primary text-primary-foreground" : "bg-background text-foreground")}>
              {x === "all" ? "Any season" : seasonLabel(x)}
            </button>
          ))}
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.filter((p) => (gf === "all" || p.grade === gf) && (sf === "all" || p.season === sf)).map((p) => {
            const qty = Math.abs(Number(p.qty));
            const unitPrice = !p.isReversal && qty > 0 ? Math.round(Number(p.total_kobo) / qty) : null;
            return (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={p.reversed ? "text-muted-foreground line-through" : "text-foreground"}>
                  {p.isReversal ? "Reversed: " : ""}{qty} {marketUnitLabel(p.market_unit)} for {formatNaira(Math.abs(Number(p.total_kobo)))}
                  {unitPrice !== null && <> · {formatNaira(unitPrice)} per {marketUnitLabel(p.market_unit)}</>}
                  {p.isReversal && p.reason ? <span className="no-underline"> · {p.reason}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatPriceDate(p.recorded_at)}
                  {p.grade ? ` · grade ${p.grade}` : ""}
                  {p.season ? ` · ${seasonLabel(p.season).toLowerCase()}` : ""}
                  {p.payment_method ? ` · ${p.payment_method}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
