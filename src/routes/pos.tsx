import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/pos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Till — NairaPlate" },
      { name: "description", content: "Ring up orders with cash, transfer or split payment." },
      { property: "og:title", content: "Till — NairaPlate" },
      { property: "og:description", content: "Ring up orders with cash, transfer or split payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosScreen,
});

type Recipe = { id: string; name: string; selling_price_kobo: number };
type Line = { recipe_id: string; quantity: number };
type Pay = "cash" | "transfer" | "split";
const POS_ROLES = new Set(["cashier", "owner", "supa_admin"]);
const TIERS = ["Standard", "Wholesale", "Event"];

function PosScreen() {
  const { loading, session } = useStaffSession();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const [channel, setChannel] = useState("Walk-in");
  const [aggName, setAggName] = useState("");
  const [tier, setTier] = useState("Standard");
  const [pay, setPay] = useState<Pay>("cash");
  const [cashN, setCashN] = useState("");
  const [trN, setTrN] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.from("recipes").select("id,name,selling_price_kobo").order("name").then(({ data, error }) => {
      if (error) return setMsg({ ok: false, text: "Could not load menu." });
      setRecipes((data ?? []).map((r) => ({ ...r, selling_price_kobo: Number(r.selling_price_kobo) })));
    });
  }, []);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.recipe_id)?.selling_price_kobo ?? 0) * l.quantity, 0);
  const cashK = pay === "split" ? nairaToKobo(Number(cashN) || 0) : pay === "cash" ? subtotal : 0;
  const trK = pay === "split" ? nairaToKobo(Number(trN) || 0) : pay === "transfer" ? subtotal : 0;
  const splitSum = cashK + trK;
  const splitOk = pay !== "split" || (cashK > 0 && trK > 0 && splitSum === subtotal);
  const finalChannel = channel === "Aggregator" ? aggName.trim() : channel;
  const canSubmit = lines.length > 0 && subtotal > 0 && splitOk && finalChannel.length > 0 && !busy;

  function addLine() {
    const q = Math.floor(Number(qty));
    if (!pick || !(q > 0)) return;
    setLines((ls) => {
      const ex = ls.find((l) => l.recipe_id === pick);
      return ex ? ls.map((l) => (l === ex ? { ...l, quantity: l.quantity + q } : l)) : [...ls, { recipe_id: pick, quantity: q }];
    });
    setQty("1");
  }

  async function submit() {
    if (!session) return;
    // Validate payment split before any insert.
    if (cashK + trK !== subtotal || (pay === "split" && (cashK <= 0 || trK <= 0))) {
      return setMsg({ ok: false, text: "Cash and transfer must add up exactly to the total." });
    }
    setBusy(true); setMsg(null);
    const { data: order, error } = await supabase.from("orders").insert({
      business_id: session.businessId, channel: finalChannel, price_tier: tier,
      subtotal_kobo: subtotal, total_kobo: subtotal, status: "paid",
      payment_method: pay, cash_amount_kobo: cashK, transfer_amount_kobo: trK, created_by: session.userId,
    }).select("id").single();
    if (error || !order) { setBusy(false); return setMsg({ ok: false, text: "Order not saved: " + (error?.message ?? "") }); }
    const { error: e2 } = await supabase.from("order_items").insert(lines.map((l) => ({
      business_id: session.businessId, order_id: order.id, recipe_id: l.recipe_id,
      quantity: l.quantity, unit_price_kobo: byId.get(l.recipe_id)!.selling_price_kobo, // snapshot at sale time
    })));
    if (e2) {
      await supabase.from("orders").update({ status: "void" }).eq("id", order.id);
      setBusy(false);
      return setMsg({ ok: false, text: "Items failed to save, order voided: " + e2.message });
    }
    setBusy(false);
    setMsg({ ok: true, text: `Order saved — ${formatNaira(subtotal)} (${pay}).` });
    setLines([]); setCashN(""); setTrN("");
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !POS_ROLES.has(session.role)) return (
    <main className="p-6 space-y-3"><p>Cashiers and owners only.</p><Link className="underline" to="/">Back</Link></main>
  );

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Till</h1><Link className="underline" to="/">Home</Link></div>

      <section className="space-y-2">
        <Label>Add item</Label>
        <div className="flex gap-2">
          <select aria-label="Item" className={sel} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a dish…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name} — {formatNaira(r.selling_price_kobo)}</option>)}
          </select>
          <Input aria-label="Quantity" className="w-20" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button onClick={addLine}>Add</Button>
        </div>
        {lines.map((l) => { const r = byId.get(l.recipe_id)!; return (
          <div key={l.recipe_id} className="flex justify-between text-sm border-b py-1">
            <span>{l.quantity} × {r.name}</span>
            <span className="flex gap-3">{formatNaira(r.selling_price_kobo * l.quantity)}
              <button className="text-destructive" onClick={() => setLines((ls) => ls.filter((x) => x !== l))}>Remove</button></span>
          </div>); })}
        <p className="text-lg font-semibold">Subtotal: {formatNaira(subtotal)}</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Channel</Label>
          <select aria-label="Channel" className={sel} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option>Walk-in</option><option>Delivery</option><option>Aggregator</option>
          </select>
          {channel === "Aggregator" && <Input aria-label="Aggregator name" placeholder="e.g. Chowdeck, Glovo" value={aggName} onChange={(e) => setAggName(e.target.value)} />}
        </div>
        <div className="space-y-1"><Label>Price tier</Label>
          <Input aria-label="Price tier" list="tiers" value={tier} onChange={(e) => setTier(e.target.value)} />
          <datalist id="tiers">{TIERS.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </section>

      <section className="space-y-2">
        <Label>Payment</Label>
        <div className="flex gap-4">
          {(["cash", "transfer", "split"] as Pay[]).map((p) => (
            <label key={p} className="flex items-center gap-1 capitalize">
              <input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} /> {p}
            </label>))}
        </div>
        {pay === "split" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input aria-label="Cash amount" placeholder="Cash ₦" type="number" value={cashN} onChange={(e) => setCashN(e.target.value)} />
              <Input aria-label="Transfer amount" placeholder="Transfer ₦" type="number" value={trN} onChange={(e) => setTrN(e.target.value)} />
            </div>
            <p className="text-sm">Entered: {formatNaira(splitSum)} of {formatNaira(subtotal)}</p>
            {splitSum !== subtotal && <p className="text-sm text-destructive">
              {splitSum < subtotal ? `${formatNaira(subtotal - splitSum)} still needed` : `${formatNaira(splitSum - subtotal)} too much`}</p>}
            {splitSum === subtotal && (cashK <= 0 || trK <= 0) && <p className="text-sm text-destructive">Both amounts must be more than ₦0 for a split.</p>}
          </div>)}
      </section>

      <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>{busy ? "Saving…" : `Charge ${formatNaira(subtotal)}`}</Button>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </main>
  );
}
