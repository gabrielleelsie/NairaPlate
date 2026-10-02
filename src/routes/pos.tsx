import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAY_CHOICE_LABEL, payChoicesFor, type PayChoice } from "@/lib/payment-ui";
import type { PaymentMode } from "@/lib/payments";
import { TransferWaiting, type WaitingRequest } from "@/components/TransferWaiting";

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
type Pay = PayChoice;
const PAY_LABEL = PAY_CHOICE_LABEL;
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
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PaymentMode | null>(null);
  const [waiting, setWaiting] = useState<WaitingRequest[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.from("recipes").select("id,name,selling_price_kobo").eq("is_current", true).order("name").then(({ data, error }) => {
      if (error) return setMsg({ ok: false, text: "Could not load menu." });
      setRecipes((data ?? []).map((r) => ({ ...r, selling_price_kobo: Number(r.selling_price_kobo) })));
    });
  }, []);

  const loadWaiting = async () => {
    const { data } = await supabase.from("payment_requests").select("id,order_id,reference,status,amount_kobo,paid_amount_kobo,created_at,account_number,bank_name,account_name")
      .in("status", ["waiting", "short"]).order("created_at", { ascending: false });
    setWaiting((data ?? []).map((d) => ({ ...(d as WaitingRequest), amount_kobo: Number(d.amount_kobo), paid_amount_kobo: d.paid_amount_kobo === null ? null : Number(d.paid_amount_kobo) })));
  };
  useEffect(() => {
    supabase.from("business_payment_settings").select("mode").maybeSingle().then(({ data }) => setMode((data?.mode as PaymentMode | undefined) ?? "manual"));
    void loadWaiting();
  }, []);
  useEffect(() => { if (mode && !payChoicesFor(mode).includes(pay)) setPay("cash"); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.recipe_id)?.selling_price_kobo ?? 0) * l.quantity, 0);
  const cashK = pay === "split" ? nairaToKobo(cashN) : pay === "cash" ? subtotal : 0;
  const trK = pay === "split" ? nairaToKobo(trN) : pay === "transfer" ? subtotal : 0;
  const splitSum = cashK + trK;
  const splitOk = pay !== "split" || (cashK > 0 && trK > 0 && splitSum === subtotal);
  const finalChannel = channel === "Aggregator" ? aggName.trim() : channel;
  const creditOk = pay !== "credit" || (custName.trim().length > 0 && custPhone.trim().length > 0);
  const canSubmit = lines.length > 0 && subtotal > 0 && splitOk && creditOk && finalChannel.length > 0 && !busy;

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
    // Automatic transfer: the order waits for the bank. Only the bank's message can mark it paid.
    if (pay === "auto_transfer") {
      setBusy(true); setMsg(null);
      const { data, error } = await supabase.rpc("create_transfer_order" as never, {
        p_channel: finalChannel, p_price_tier: tier, p_items: lines.map((l) => ({ recipe_id: l.recipe_id, quantity: l.quantity })),
      } as never);
      if (error) { setBusy(false); return setMsg({ ok: false, text: "Order not saved: " + error.message }); }
      const created = data as { request_id: string; amount_kobo: number };
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/public/payment-start", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
        body: JSON.stringify({ request_id: created.request_id }),
      }).catch(() => null);
      setBusy(false);
      if (!res || !res.ok) {
        const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        setMsg({ ok: false, text: `Order saved and waiting, but no account number yet: ${j.error ?? "could not reach the bank service"}. Cancel it below or try again.` });
      } else setMsg(null);
      setLines([]);
      await loadWaiting();
      return;
    }
    // Credit sale: order + items + customer_credits row saved together in one database step.
    if (pay === "credit") {
      setBusy(true); setMsg(null);
      const { data, error } = await supabase.rpc("create_credit_order" as never, {
        p_channel: finalChannel, p_price_tier: tier, p_customer_name: custName.trim(), p_phone: custPhone.trim(),
        p_items: lines.map((l) => ({ recipe_id: l.recipe_id, quantity: l.quantity })),
      } as never);
      setBusy(false);
      if (error) return setMsg({ ok: false, text: "Order not saved: " + error.message });
      const total = Number((data as { total_kobo: number }).total_kobo);
      setMsg({ ok: true, text: `Order saved — ${custName.trim()} owes ${formatNaira(total)}.` });
      setLines([]); setCustName(""); setCustPhone("");
      return;
    }
    // Validate payment split before any insert.
    if (cashK + trK !== subtotal || (pay === "split" && (cashK <= 0 || trK <= 0))) {
      return setMsg({ ok: false, text: "Cash and transfer must add up exactly to the total." });
    }
    setBusy(true); setMsg(null);
    // The database reads every price from the menu and works out the total itself. Only the dishes, quantities and the payment split are sent.
    const { data, error } = await supabase.rpc("create_cash_order" as never, {
      p_channel: finalChannel, p_price_tier: tier, p_payment_method: pay, p_cash_kobo: cashK, p_transfer_kobo: trK,
      p_items: lines.map((l) => ({ recipe_id: l.recipe_id, quantity: l.quantity })),
    } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Order not saved: " + error.message });
    const saved = data as { total_kobo: number };
    setMsg({ ok: true, text: `Order saved — ${formatNaira(Number(saved.total_kobo))} (${pay}).` });
    setLines([]); setCashN(""); setTrN("");
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !POS_ROLES.has(session.role)) return (
    <main className="p-6 space-y-3"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Back</Link></main>
  );

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Till</h1><Link className="underline" to="/app">Home</Link></div>

      {waiting.map((w) => (
        <TransferWaiting key={w.id} initial={w} onFinished={(text, ok) => { setMsg({ ok, text }); void loadWaiting(); }} />
      ))}

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
        <div className="flex flex-wrap gap-4">
          {payChoicesFor(mode).map((p) => (
            <label key={p} className="flex items-center gap-1">
              <input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} /> {PAY_LABEL[p]}
            </label>))}
        </div>
        {pay === "credit" && (
          <div className="flex gap-2">
            <Input aria-label="Customer name" placeholder="Customer name" value={custName} onChange={(e) => setCustName(e.target.value)} />
            <Input aria-label="Customer phone" placeholder="Phone" type="tel" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
          </div>)}
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

      <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>{busy ? "Saving…" : pay === "credit" ? `Put ${formatNaira(subtotal)} on credit` : pay === "auto_transfer" ? `Ask for ${formatNaira(subtotal)} by transfer` : `Charge ${formatNaira(subtotal)}`}</Button>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </main>
  );
}
