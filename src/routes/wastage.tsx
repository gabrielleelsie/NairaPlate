import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, MARKET_UNIT_OPTIONS, marketUnitLabel } from "@/lib/staff-session";
import {
  convertAndCostIngredient, formatNaira,
  type CostIngredient, type CostConversion,
} from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/wastage")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Log wastage — NairaPlate" },
      { name: "description", content: "Record spoiled or wasted ingredients and what they cost." },
      { property: "og:title", content: "Log wastage — NairaPlate" },
      { property: "og:description", content: "Record spoiled or wasted ingredients and what they cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WastageScreen,
});

const ROLES = new Set(["cook", "purchaser", "owner", "supa_admin"]);
const REASONS = ["Spoilage", "Over-cooking", "Contamination", "Other"];

function WastageScreen() {
  const { loading, session } = useStaffSession();
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [ingId, setIngId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
    ]).then(([i, c]) => {
      setIngredients((i.data ?? []).map((x) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo) })));
      setConversions((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
    });
  }, []);

  const ing = ingredients.find((i) => i.id === ingId);
  // The ONLY costing on this screen — the shared function from costing.ts.
  const cost = useMemo(
    () => (ingId && unit && Number(qty) > 0
      ? convertAndCostIngredient({ ingredientId: ingId, qty: Number(qty), unit, ingredients, conversions })
      : null),
    [ingId, unit, qty, ingredients, conversions],
  );

  async function submit() {
    if (!session || !cost) return;
    if (cost.error || cost.cost_kobo === null) return setMsg({ ok: false, text: cost.error ?? "No conversion set up." });
    setBusy(true); setMsg(null);
    const cost_kobo = Math.round(cost.cost_kobo);
    const { error } = await supabase.from("wastage_logs").insert({
      business_id: session.businessId, ingredient_id: ingId, qty: Number(qty), unit,
      cost_kobo, reason, logged_by: session.userId,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `Logged ${qty} ${marketUnitLabel(unit)} of ${ing?.name} — cost ${formatNaira(cost_kobo)}.` });
    setQty("");
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Kitchen, purchasing and owners only.</p><Link className="underline" to="/">Back</Link></main>;

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Log wastage</h1><Link className="underline" to="/">Home</Link></div>
      <div className="space-y-1"><Label htmlFor="w-ing">Ingredient</Label>
        <select id="w-ing" className={sel} value={ingId} onChange={(e) => { setIngId(e.target.value); setUnit(""); }}>
          <option value="">Choose…</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="w-qty">Quantity</Label>
          <Input id="w-qty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="w-unit">Unit</Label>
          <select id="w-unit" className={sel} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!ing}>
            <option value="">Choose…</option>
            {MARKET_UNIT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="w-reason">Reason</Label>
        <select id="w-reason" className={sel} value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r}>{r}</option>)}
        </select></div>
      {cost?.error && <p className="text-sm text-destructive" role="alert">{cost.error}</p>}
      {cost && !cost.error && <p>Cost of this waste: <strong>{formatNaira(Math.round(cost.cost_kobo ?? 0))}</strong></p>}
      <Button className="w-full" disabled={busy || !cost || !!cost.error} onClick={submit}>Log wastage</Button>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </main>
  );
}
