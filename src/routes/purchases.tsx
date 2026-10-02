import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, MARKET_UNIT_OPTIONS, marketUnitLabel } from "@/lib/staff-session";
import {
  convertAndCostIngredient, formatNaira, nairaToKobo,
  type CostIngredient, type CostConversion,
} from "@/lib/costing";
import { parsePurchase } from "@/lib/voice-parse";
import { GRADES, extractGrade, isGrade, type Grade } from "@/lib/grade";
import { SEASONS, extractSeason, isSeason, seasonHint, seasonLabel, type Season } from "@/lib/season";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isOwnerRole } from "@/lib/catering-order";
import { PURCHASE_COLUMNS, describePurchases, livePurchases, normalisePurchases, reasonOk, reversalPreview, reverseBlocked, type IngredientNow, type PurchaseRow } from "@/lib/purchases";
import { TXN_COLUMNS, normaliseTxns, supplierBalance } from "@/lib/suppliers";

export const Route = createFileRoute("/purchases")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Log purchases — NairaPlate" },
      { name: "description", content: "Record market purchases by typing or speaking, and keep ingredient prices current." },
      { property: "og:title", content: "Log purchases — NairaPlate" },
      { property: "og:description", content: "Record market purchases by typing or speaking, and keep ingredient prices current." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchaseScreen,
});

const ROLES = new Set(["purchaser", "owner", "supa_admin"]);
const PAY = ["cash", "transfer", "credit"] as const;
type Hist = PurchaseRow;
type IngGrade = { id: string; current_grade: string | null; current_season: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSR = (): any => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

function PurchaseScreen() {
  const { loading, session } = useStaffSession();
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [ingNow, setIngNow] = useState<Map<string, IngredientNow>>(new Map());
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [revBalance, setRevBalance] = useState<number | null>(null);
  const [ingId, setIngId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [paid, setPaid] = useState("");
  const [grade, setGrade] = useState<Grade | "">("");
  const [season, setSeason] = useState<Season | "">("");
  const [lastSeasons, setLastSeasons] = useState<Map<string, string | null>>(new Map());
  const [pastPrices, setPastPrices] = useState<{ grade: string | null; market_unit: string; unit_price: number }[]>([]);
  const [lastGrades, setLastGrades] = useState<Map<string, string | null>>(new Map());
  const [pay, setPay] = useState<string>("cash");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [unsure, setUnsure] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const recRef = useRef<unknown>(null);

  async function load() {
    const [i, c, h, s] = await Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo,current_grade,current_season,price_updated_at,stock_base_qty").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
      supabase.from("purchases").select(PURCHASE_COLUMNS).order("recorded_at", { ascending: false }).limit(30),
      supabase.from("suppliers").select("id,name").order("name"),
    ]);
    setLastSeasons(new Map(((i.data ?? []) as IngGrade[]).map((x) => [x.id, x.current_season])));
    setLastGrades(new Map(((i.data ?? []) as IngGrade[]).map((x) => [x.id, x.current_grade])));
    setIngNow(new Map((i.data ?? []).map((x) => [x.id, { price_updated_at: (x.price_updated_at as string | null) ?? null, stock_base_qty: Number(x.stock_base_qty ?? 0), base_unit: x.base_unit as string, name: x.name as string }])));
    setIngredients((i.data ?? []).map(({ current_grade: _g, current_season: _s, price_updated_at: _p, stock_base_qty: _q, ...x }) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo) })));
    setConversions((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
    setHistory(normalisePurchases(h.data as unknown[]));
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
  }
  useEffect(() => { load(); setMicOk(!!getSR()); }, []);

  // This ingredient's own purchases from the last 12 months, used only to hint at a season.
  useEffect(() => {
    if (!ingId) { setPastPrices([]); return; }
    let cancelled = false;
    const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    supabase.from("purchases").select("id,qty,market_unit,total_kobo,grade,recorded_at,payment_method,ingredient_id,season,kind,reverses_id").eq("ingredient_id", ingId).gte("recorded_at", since)
      .then(({ data }) => {
        if (cancelled) return;
        // Reversals, and purchases that were reversed, do not count towards a season hint.
        setPastPrices(livePurchases(normalisePurchases(data as unknown[])).filter((x) => x.qty > 0).map((x) => ({ grade: x.grade, market_unit: x.market_unit, unit_price: x.total_kobo / x.qty })));
      });
    return () => { cancelled = true; };
  }, [ingId, history.length]);

  const ing = ingredients.find((i) => i.id === ingId);
  const conv = useMemo(
    () => (ingId && unit && Number(qty) > 0
      ? convertAndCostIngredient({ ingredientId: ingId, qty: Number(qty), unit, ingredients, conversions })
      : null),
    [ingId, unit, qty, ingredients, conversions],
  );
  const newUnitCost = conv?.base_qty && Number(paid) > 0 ? Math.round(nairaToKobo(paid) / conv.base_qty) : null;

  // Hint: this price per market unit against the owner's usual for the same grade and unit.
  const hint = useMemo(() => {
    if (!unit || !(Number(qty) > 0) || !(Number(paid) > 0)) return null;
    const mine = pastPrices.filter((p) => p.market_unit === unit && (!grade || p.grade === grade)).map((p) => p.unit_price);
    return seasonHint(nairaToKobo(paid) / Number(qty), mine);
  }, [pastPrices, unit, qty, paid, grade]);

  function startVoice() {
    const SR = getSR();
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-NG"; rec.interimResults = false; rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => applyTranscript(String(e.results[0][0].transcript));
    rec.onerror = () => { setListening(false); setMsg({ ok: false, text: "Didn't catch that. Try again or type it in." }); };
    rec.onend = () => setListening(false);
    recRef.current = rec; setListening(true); setMsg(null); rec.start();
  }

  // Only pre-fills the form. Never submits.
  function applyTranscript(text: string) {
    const { grade: spoken, rest: r1 } = extractGrade(text);
    const { season: spokenSeason, rest } = extractSeason(r1);
    const p = parsePurchase(rest, ingredients);
    const miss = new Set<string>();
    setTranscript(text);
    setIngId(p.ingredient_id ?? ""); if (!p.ingredient_id) miss.add("ing");
    if (spoken) setGrade(spoken);
    else { const last = p.ingredient_id ? lastGrades.get(p.ingredient_id) : null; setGrade(isGrade(last) ? last : ""); miss.add("grade"); }
    if (spokenSeason) setSeason(spokenSeason);
    else { const lastS = p.ingredient_id ? lastSeasons.get(p.ingredient_id) : null; setSeason(isSeason(lastS) ? lastS : ""); miss.add("season"); }
    setQty(p.qty !== null ? String(p.qty) : ""); if (p.qty === null) miss.add("qty");
    setUnit(p.market_unit ?? ""); if (!p.market_unit) miss.add("unit");
    setPaid(p.total_naira !== null ? String(p.total_naira) : ""); if (p.total_naira === null) miss.add("paid");
    setUnsure(miss);
  }
  (window as unknown as { __npVoice?: (t: string) => void }).__npVoice = applyTranscript; // used by automated tests

  async function submit() {
    if (!session) return;
    if (!ingId || !(Number(qty) > 0) || !unit || !(Number(paid) > 0)) return setMsg({ ok: false, text: "Fill in ingredient, quantity, unit and amount paid." });
    if (!grade) return setMsg({ ok: false, text: "Choose a grade: A, B or C." });
    if (!season) return setMsg({ ok: false, text: "Choose a season: Plenty, Normal or Scarce." });
    if (!conv || conv.error || !conv.base_qty) return setMsg({ ok: false, text: conv?.error ?? "No conversion set up." });
    setBusy(true); setMsg(null);
    // log_purchase also records the supplier debt (purchase_on_credit) in the same transaction.
    const { data, error } = await supabase.rpc("log_purchase", {
      p_ingredient_id: ingId, p_qty: Number(qty), p_market_unit: unit,
      p_total_kobo: nairaToKobo(paid), p_payment_method: pay, p_grade: grade, p_season: season, p_raw_transcript: transcript,
      ...(supplierId ? { p_supplier_id: supplierId } : {}),
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const r = data as { previous_cost_kobo: number; current_cost_kobo: number; flagged: boolean; pct: number | null; note: string | null; season: string; previous_grade: string | null };
    setMsg({ ok: true, text: `Saved ${qty} ${marketUnitLabel(unit)} of ${ing?.name}. New price ${formatNaira(r.current_cost_kobo)} per ${ing?.base_unit} (was ${formatNaira(r.previous_cost_kobo)}).${r.flagged ? ` Price up ${r.pct}% on the last grade ${grade} (${seasonLabel(season).toLowerCase()} season). Owner alerted.` : ""}${r.note === "first_of_grade" ? ` First time buying grade ${grade}${r.previous_grade ? ` (last was grade ${r.previous_grade})` : ""}, so no price alert.` : ""}` });
    setQty(""); setPaid(""); setTranscript(null); setUnsure(new Set());
    load();
  }

  async function openReverse(h: PurchaseRow) {
    setReverseFor(h.id); setReverseReason(""); setRevBalance(null); setMsg(null);
    if (h.payment_method === "credit" && h.supplier_id) {
      const { data } = await supabase.from("supplier_transactions").select(TXN_COLUMNS).eq("supplier_id", h.supplier_id);
      setRevBalance(supplierBalance(normaliseTxns(data as unknown[]), h.supplier_id));
    }
  }

  async function reversePurchase(h: PurchaseRow) {
    if (!reasonOk(reverseReason) || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("reverse_purchase" as never, { p_purchase_id: h.id, p_reason: reverseReason.trim() } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not reversed: " + error.message });
    const r = data as { stock_after: number; below_zero: boolean; supplier_owes_you_kobo: number };
    const name = ingNow.get(h.ingredient_id)?.name ?? "The ingredient";
    setMsg({ ok: true, text: `The purchase was reversed. ${name} is back to its earlier price.${r.below_zero ? ` Stock is now below zero (${Number(r.stock_after)}). Check the stock count.` : ""}${Number(r.supplier_owes_you_kobo) > 0 ? ` This reversal leaves the supplier owing you ${formatNaira(Number(r.supplier_owes_you_kobo))}.` : ""}` });
    setReverseFor(null); setReverseReason(""); setRevBalance(null);
    load();
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Purchasers and owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  const flag = (k: string) => (unsure.has(k) ? " border-warning ring-2 ring-warning/60 bg-warning/10" : "");
  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  const names = new Map(ingredients.map((i) => [i.id, i.name]));

  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Log purchase</h1><Link className="underline" to="/app">Home</Link></div>

      {micOk && (
        <Button type="button" variant={listening ? "destructive" : "outline"} className="w-full" onClick={startVoice} disabled={listening}>
          <Mic className="mr-2 h-4 w-4" />{listening ? "Listening… speak now" : "Speak the purchase"}
        </Button>
      )}

      <div className="space-y-1"><Label htmlFor="p-ing">Ingredient</Label>
        <select id="p-ing" className={sel + flag("ing")} value={ingId} onChange={(e) => { setIngId(e.target.value); setUnit(""); { const last = lastGrades.get(e.target.value); setGrade(isGrade(last) ? last : ""); const lastS = lastSeasons.get(e.target.value); setSeason(isSeason(lastS) ? lastS : ""); } setUnsure((s) => { const n = new Set(s); n.delete("ing"); return n; }); }}>
          <option value="">Choose…</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="p-qty">Quantity</Label>
          <Input id="p-qty" className={flag("qty")} type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="p-unit">Unit</Label>
          <select id="p-unit" className={sel + flag("unit")} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!ing}>
            <option value="">Choose…</option>
            {MARKET_UNIT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="p-paid">Total paid (₦)</Label>
        <Input id="p-paid" className={flag("paid")} type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} />
        {unsure.has("paid") && <p className="text-xs text-foreground">Say the full amount, like 'four thousand five hundred' or 'forty five hundred', or type it in.</p>}
      </div>
      <div className="space-y-1"><Label id="p-grade-l">Grade (required)</Label>
        <div role="radiogroup" aria-labelledby="p-grade-l" className={"flex gap-2 rounded-md" + (unsure.has("grade") && !grade ? " ring-2 ring-warning/60" : "")}>
          {GRADES.map((g) => (
            <Button key={g} type="button" role="radio" aria-checked={grade === g} variant={grade === g ? "default" : "outline"} className="flex-1"
              onClick={() => { setGrade(g); setUnsure((s) => { const n = new Set(s); n.delete("grade"); return n; }); }}>{g}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">A is the best quality, C the lowest. Prices are tracked per grade.</p>
      </div>
      <div className="space-y-1"><Label id="p-season-l">Season (required)</Label>
        <div role="radiogroup" aria-labelledby="p-season-l" className={"flex gap-2 rounded-md" + (unsure.has("season") && !season ? " ring-2 ring-warning/60" : "")}>
          {SEASONS.map((x) => (
            <Button key={x} type="button" role="radio" aria-checked={season === x} variant={season === x ? "default" : "outline"} className="flex-1"
              onClick={() => { setSeason(x); setUnsure((s) => { const n = new Set(s); n.delete("season"); return n; }); }}>{seasonLabel(x)}</Button>
          ))}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{`This is about ${Math.abs(hint.pctVsUsual)}% ${hint.pctVsUsual < 0 ? "below" : hint.pctVsUsual > 0 ? "above" : "in line with"} your usual price for this unit. That looks like ${seasonLabel(hint.season).toLowerCase()}. You choose.`}</p>}
        <p className="text-xs text-muted-foreground">How easy is it to find right now? Plenty means cheap and everywhere, Scarce means short and dear.</p>
      </div>
      <div className="space-y-1"><Label htmlFor="p-pay">Payment</Label>
        <select id="p-pay" className={sel} value={pay} onChange={(e) => setPay(e.target.value)}>
          {PAY.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select></div>
      <div className="space-y-1"><Label htmlFor="p-sup">Supplier (optional)</Label>
        <select id="p-sup" className={sel} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— none —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {supplierId && pay === "credit" && <p className="text-xs text-muted-foreground">This amount will be added to what you owe this supplier.</p>}
      </div>

      {conv?.error && <p className="text-sm text-destructive">{conv.error}</p>}
      {newUnitCost !== null && ing && (
        <p className="text-sm text-muted-foreground">New price: {formatNaira(newUnitCost)} per {ing.base_unit} (now {formatNaira(ing.current_cost_kobo)})</p>
      )}
      <Button className="w-full" onClick={submit} disabled={busy || !!conv?.error}>{busy ? "Saving…" : "Submit purchase"}</Button>
      {msg && <p className={msg.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
      {transcript && <p className="rounded-md border border-border bg-muted p-2 text-sm"><span className="text-muted-foreground">Heard: </span>"{transcript}"</p>}

      <section className="pt-4 space-y-2">
        <h2 className="font-semibold">Recent purchases</h2>
        {history.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="divide-y divide-border">
          {describePurchases(history).map((h) => {
            const ingr = ingNow.get(h.ingredient_id);
            const blocked = isOwnerRole(session.role) && !h.isReversal && !h.reversed ? reverseBlocked(h, ingr, session.role) : null;
            const canRev = isOwnerRole(session.role) && !h.isReversal && !h.reversed && blocked === null;
            const pv = reverseFor === h.id && ingr ? reversalPreview(h, ingr, revBalance) : null;
            return (
              <li key={h.id} className="py-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className={"flex items-center gap-1" + (h.reversed ? " line-through text-muted-foreground" : "")}>
                    {h.raw_transcript && <Mic aria-label="Voice entry" className="h-3 w-3 text-muted-foreground" />}
                    {h.isReversal ? "Reversal: " : ""}{names.get(h.ingredient_id) ?? "?"}{h.grade || h.season ? ` (${[h.grade, h.season ? seasonLabel(h.season).toLowerCase() : null].filter(Boolean).join(", ")})` : ""} · {Math.abs(Number(h.qty))} {marketUnitLabel(h.market_unit)}
                  </span>
                  <span className={"text-right" + (h.reversed ? " line-through text-muted-foreground" : "")}>{h.isReversal ? "−" : ""}{formatNaira(Math.abs(Number(h.total_kobo)))}<br /><span className="text-xs text-muted-foreground">{new Date(h.recorded_at).toLocaleDateString("en-NG")}</span></span>
                </div>
                {h.reversed && <div className="text-xs font-semibold text-destructive">Reversed: {h.reversedByReason}</div>}
                {h.isReversal && h.reason && <div className="text-xs text-muted-foreground">Reason: {h.reason}{h.recorded_by_name ? ` · ${h.recorded_by_name}` : ""}</div>}
                {!h.isReversal && !h.reversed && blocked && isOwnerRole(session.role) && <div className="text-xs text-muted-foreground">{blocked}</div>}
                {canRev && reverseFor !== h.id && <Button size="sm" variant="outline" onClick={() => openReverse(h)}>Reverse</Button>}
                {canRev && reverseFor === h.id && (
                  <div className="rounded-md bg-muted p-2 space-y-2">
                    {pv && (
                      <ul className="text-xs space-y-0.5">
                        {pv.priceBackKobo != null && <li>{ingr?.name} goes back to {formatNaira(pv.priceBackKobo)} per {ingr?.base_unit}{pv.grade ? ` (grade ${pv.grade}${pv.season ? `, ${seasonLabel(pv.season).toLowerCase()}` : ""})` : ""}.</li>}
                        <li>Stock goes down by {Number(h.base_qty)} {ingr?.base_unit}, to {pv.stockAfter} {ingr?.base_unit}.</li>
                        {pv.belowZero && <li className="font-semibold text-destructive">Stock will go below zero. Check the stock count after this.</li>}
                        {pv.supplierBalanceAfterKobo != null && <li>What you owe the supplier goes down by {formatNaira(Number(h.total_kobo))}.</li>}
                        {pv.supplierOwesYouKobo > 0 && <li className="font-semibold text-destructive">This reversal leaves the supplier owing you {formatNaira(pv.supplierOwesYouKobo)}.</li>}
                      </ul>
                    )}
                    <Input aria-label="Reason for reversing" placeholder="Why is this being reversed? (5 or more characters)" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busy || !reasonOk(reverseReason)} onClick={() => reversePurchase(h)}>Reverse this purchase</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReverseFor(null); setReverseReason(""); setRevBalance(null); }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
