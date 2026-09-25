import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/credit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Customer credit — NairaPlate" },
      { name: "description", content: "Track customers who owe money and mark debts as paid." },
      { property: "og:title", content: "Customer credit — NairaPlate" },
      { property: "og:description", content: "Track customers who owe money and mark debts as paid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditScreen,
});

const ROLES = new Set(["cashier", "owner", "supa_admin"]);
type Credit = { id: string; customer_name: string; phone: string | null; amount_kobo: number; settled: boolean; order_id?: string | null; created_at: string };

function CreditScreen() {
  const { loading, session } = useStaffSession();
  const [rows, setRows] = useState<Credit[]>([]);
  const [tab, setTab] = useState<"owing" | "settled">("owing");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data, error } = await supabase.from("customer_credits").select("*").order("created_at", { ascending: false });
    if (error) return setMsg({ ok: false, text: "Could not load: " + error.message });
    setRows((data ?? []).map((r) => ({ ...(r as Credit), amount_kobo: Number(r.amount_kobo) })));
  }
  useEffect(() => { if (session) load(); }, [session]);

  async function add() {
    if (!session) return;
    const amount_kobo = nairaToKobo(amount);
    if (!name.trim() || !(amount_kobo > 0)) return;
    const { error } = await supabase.from("customer_credits").insert({
      business_id: session.businessId, customer_name: name.trim(), phone: phone.trim() || null, amount_kobo, settled: false,
    });
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `${name.trim()} now owes ${formatNaira(amount_kobo)}.` });
    setName(""); setPhone(""); setAmount(""); load();
  }

  async function settle(r: Credit) {
    // Never deleted — it moves to the Settled list for history.
    const { error } = await supabase.from("customer_credits").update({ settled: true }).eq("id", r.id);
    if (error) return setMsg({ ok: false, text: "Not updated: " + error.message });
    setMsg({ ok: true, text: `${r.customer_name}'s ${formatNaira(r.amount_kobo)} marked as paid.` });
    load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Cashiers and owners only.</p><Link className="underline" to="/">Home</Link></main>;

  const shown = rows.filter((r) => r.settled === (tab === "settled"));
  const owingTotal = rows.filter((r) => !r.settled).reduce((s, r) => s + r.amount_kobo, 0);

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Customer credit</h1><Link className="underline" to="/">Home</Link></div>

      <section className="rounded-md border p-3 space-y-2">
        <h2 className="font-semibold">Add credit</h2>
        <div className="space-y-1"><Label htmlFor="c-name">Customer name</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="c-amount">Amount owed (₦)</Label><Input id="c-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <Button onClick={add} disabled={!name.trim() || !(Number(amount) > 0)}>Add credit</Button>
      </section>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <div className="flex gap-2">
        <Button variant={tab === "owing" ? "default" : "outline"} onClick={() => setTab("owing")}>Still owing</Button>
        <Button variant={tab === "settled" ? "default" : "outline"} onClick={() => setTab("settled")}>Settled</Button>
      </div>
      {tab === "owing" && <p className="font-semibold">Total owed to you: {formatNaira(owingTotal)}</p>}

      <ul className="space-y-2" data-testid={`list-${tab}`}>
        {shown.length === 0 && <li className="text-muted-foreground">Nothing here.</li>}
        {shown.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">{r.customer_name}</div>
              <div className="text-sm text-muted-foreground">{r.phone ?? "no phone"}{r.order_id ? " · from a till sale" : ""} · {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatNaira(r.amount_kobo)}</span>
              {!r.settled && <Button size="sm" variant="outline" onClick={() => settle(r)}>Mark settled</Button>}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
