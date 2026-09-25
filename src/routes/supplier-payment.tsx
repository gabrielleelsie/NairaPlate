import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { SUPPLIER_ROLES, normaliseTxns, supplierBalance, type SupplierTxn } from "@/lib/suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/supplier-payment")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { supplier?: string } =>
    typeof s['supplier'] === "string" ? { supplier: s['supplier'] } : {},
  head: () => ({
    meta: [
      { title: "Record supplier payment — NairaPlate" },
      { name: "description", content: "Record money paid to a supplier to reduce what you owe them." },
      { property: "og:title", content: "Record supplier payment — NairaPlate" },
      { property: "og:description", content: "Record money paid to a supplier to reduce what you owe them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierPayment,
});

const sel = "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function SupplierPayment() {
  const search = Route.useSearch();
  const { loading, session } = useStaffSession();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [txns, setTxns] = useState<SupplierTxn[]>([]);
  const [supplierId, setSupplierId] = useState(search.supplier ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [s, t] = await Promise.all([
      supabase.from("suppliers").select("id,name").order("name"),
      supabase.from("supplier_transactions").select("id,supplier_id,type,amount_kobo,purchase_id,note,created_at"),
    ]);
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
    setTxns(normaliseTxns(t.data));
  }
  useEffect(() => { if (session) load(); }, [session]);

  async function save() {
    if (!session) return;
    const amount_kobo = nairaToKobo(amount);
    if (!supplierId || !(amount_kobo > 0)) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("supplier_transactions").insert({
      business_id: session.businessId, supplier_id: supplierId, type: "payment",
      amount_kobo, note: note.trim() || null, recorded_by: session.userId,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const after = supplierBalance(txns, supplierId) - amount_kobo;
    const name = suppliers.find((s) => s.id === supplierId)?.name;
    setMsg({ ok: true, text: `Paid ${formatNaira(amount_kobo)} to ${name}. You now owe ${formatNaira(after)}.` });
    setAmount(""); setNote(""); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !SUPPLIER_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Purchasers and owners only.</p><Link className="underline" to="/">Home</Link></main>;

  const owed = supplierId ? supplierBalance(txns, supplierId) : null;

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Pay a supplier</h1><Link className="underline" to="/suppliers">Suppliers</Link></div>
      <div className="space-y-1"><Label htmlFor="sp-sup">Supplier</Label>
        <select id="sp-sup" className={sel} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Pick a supplier</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {owed !== null && <p className="text-sm text-muted-foreground">You owe them {formatNaira(owed)}.</p>}
      </div>
      <div className="space-y-1"><Label htmlFor="sp-amt">Amount paid (₦)</Label><Input id="sp-amt" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="sp-note">Note (optional)</Label><Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. transfer to Opay" /></div>
      <Button className="w-full" onClick={save} disabled={busy || !supplierId || !(Number(amount) > 0)}>{busy ? "Saving…" : "Record payment"}</Button>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </main>
  );
}
