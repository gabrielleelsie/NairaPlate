import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import {
  convertAndCostIngredient, unitsForIngredient, formatNaira, nairaToKobo,
  type CostIngredient, type CostConversion,
} from "@/lib/costing";
import { parsePurchase } from "@/lib/voice-parse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
type Hist = { id: string; ingredient_id: string; qty: number; market_unit: string; total_kobo: number; recorded_at: string; raw_transcript: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSR = (): any => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

function PurchaseScreen() {
  const { loading, session } = useStaffSession();
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [ingId, setIngId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [paid, setPaid] = useState("");
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
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
      supabase.from("purchases").select("id,ingredient_id,qty,market_unit,total_kobo,recorded_at,raw_transcript").order("recorded_at", { ascending: false }).limit(30),
      supabase.from("suppliers").select("id,name").order("name"),
    ]);
    setIngredients((i.data ?? []).map((x) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo) })));
    setConversions((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
    setHistory((h.data ?? []) as Hist[]);
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
  }
  useEffect(() => { load(); setMicOk(!!getSR()); }, []);

  const ing = ingredients.find((i) => i.id === ingId);
  const units = unitsForIngredient(ing, conversions); // shared unit filter (same as recipes & wastage)
  const conv = useMemo(
    () => (ingId && unit && Number(qty) > 0
      ? convertAndCostIngredient({ ingredientId: ingId, qty: Number(qty), unit, ingredients, conversions })
      : null),
    [ingId, unit, qty, ingredients, conversions],
  );
  const newUnitCost = conv?.base_qty && Number(paid) > 0 ? Math.round(nairaToKobo(paid) / conv.base_qty) : null;

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
    const p = parsePurchase(text, ingredients);
    const miss = new Set<string>();
    setTranscript(text);
    setIngId(p.ingredient_id ?? ""); if (!p.ingredient_id) miss.add("ing");
    setQty(p.qty !== null ? String(p.qty) : ""); if (p.qty === null) miss.add("qty");
    setUnit(p.market_unit ?? ""); if (!p.market_unit) miss.add("unit");
    setPaid(p.total_naira !== null ? String(p.total_naira) : ""); if (p.total_naira === null) miss.add("paid");
    setUnsure(miss);
  }
  (window as unknown as { __npVoice?: (t: string) => void }).__npVoice = applyTranscript; // used by automated tests

  async function submit() {
    if (!session) return;
    if (!ingId || !(Number(qty) > 0) || !unit || !(Number(paid) > 0)) return setMsg({ ok: false, text: "Fill in ingredient, quantity, unit and amount paid." });
    if (!conv || conv.error || !conv.base_qty) return setMsg({ ok: false, text: conv?.error ?? "No conversion set up." });
    setBusy(true); setMsg(null);
    // log_purchase also records the supplier debt (purchase_on_credit) in the same transaction.
    const { data, error } = await supabase.rpc("log_purchase", {
      p_ingredient_id: ingId, p_qty: Number(qty), p_market_unit: unit,
      p_total_kobo: nairaToKobo(paid), p_payment_method: pay, p_raw_transcript: transcript,
      ...(supplierId ? { p_supplier_id: supplierId } : {}),
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const r = data as { previous_cost_kobo: number; current_cost_kobo: number; flagged: boolean; pct: number | null };
    setMsg({ ok: true, text: `Saved. ${ing?.name} now ${formatNaira(r.current_cost_kobo)} per ${ing?.base_unit} (was ${formatNaira(r.previous_cost_kobo)}).${r.flagged ? ` Price up ${r.pct}% — owner alerted.` : ""}` });
    setQty(""); setPaid(""); setTranscript(null); setUnsure(new Set());
    load();
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Purchasers and owners only.</p><Link className="underline" to="/">Back</Link></main>;

  const flag = (k: string) => (unsure.has(k) ? " border-warning ring-2 ring-warning/60 bg-warning/10" : "");
  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  const names = new Map(ingredients.map((i) => [i.id, i.name]));

  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Log purchase</h1><Link className="underline" to="/">Home</Link></div>

      {micOk && (
        <Button type="button" variant={listening ? "destructive" : "outline"} className="w-full" onClick={startVoice} disabled={listening}>
          <Mic className="mr-2 h-4 w-4" />{listening ? "Listening… speak now" : "Speak the purchase"}
        </Button>
      )}

      <div className="space-y-1"><Label htmlFor="p-ing">Ingredient</Label>
        <select id="p-ing" className={sel + flag("ing")} value={ingId} onChange={(e) => { setIngId(e.target.value); setUnit(""); setUnsure((s) => { const n = new Set(s); n.delete("ing"); return n; }); }}>
          <option value="">Choose…</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="p-qty">Quantity</Label>
          <Input id="p-qty" className={flag("qty")} type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="p-unit">Unit</Label>
          <select id="p-unit" className={sel + flag("unit")} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!ing}>
            <option value="">Choose…</option>
            {unit && !units.includes(unit) && <option value={unit}>{unit} (no conversion)</option>}
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="p-paid">Total paid (₦)</Label>
        <Input id="p-paid" className={flag("paid")} type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} />
        {unsure.has("paid") && <p className="text-xs text-foreground">Say the full amount, like 'four thousand five hundred' or 'forty five hundred', or type it in.</p>}
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
          {history.map((h) => (
            <li key={h.id} className="flex justify-between py-2 text-sm">
              <span className="flex items-center gap-1">
                {h.raw_transcript && <Mic aria-label="Voice entry" className="h-3 w-3 text-muted-foreground" />}
                {names.get(h.ingredient_id) ?? "?"} · {Number(h.qty)} {h.market_unit}
              </span>
              <span className="text-right">{formatNaira(Number(h.total_kobo))}<br /><span className="text-xs text-muted-foreground">{new Date(h.recorded_at).toLocaleDateString("en-NG")}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
