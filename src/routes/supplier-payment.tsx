import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { PAYMENT_METHODS, SUPPLIER_ROLES, TXN_COLUMNS, advanceWarning, balanceWords, methodProblem, normaliseTxns, supplierBalance, type SupplierTxn } from "@/lib/suppliers";
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
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [s, t] = await Promise.all([
      supabase.from("suppliers").select("id,name").order("name"),
      supabase.from("supplier_transactions").select(TXN_COLUMNS),
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
    // The database records the payment and works out the balance. Paying more than is owed is allowed once the person has confirmed it.
    // The person must say how it was paid. "Cash from the drawer": the payment and the cash taken out of the open shift are saved together, or neither is.
    const { data, error } = await supabase.rpc("record_supplier_payment_v2" as never, { p_supplier_id: supplierId, p_amount_kobo: amount_kobo, p_note: note.trim(), p_method: method } as never);
    setBusy(false); setConfirming(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const after = Number((data as { balance_kobo: number }).balance_kobo);
    const name = suppliers.find((s) => s.id === supplierId)?.name;
    setMsg({ ok: true, text: `Paid ${formatNaira(amount_kobo)} to ${name}. ${balanceWords(after, formatNaira)} now. To add a photo of the receipt, open this supplier and tap Add photo on the payment.` });
    setAmount(""); setNote(""); setMethod(""); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !SUPPLIER_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Purchasers and owners only.</p><Link className="underline" to="/app">Home</Link></main>;

  const owed = supplierId ? supplierBalance(txns, supplierId) : null;
  const amountKobo = nairaToKobo(amount);
  const warning = owed === null ? null : advanceWarning(owed, amountKobo);
  const problem = method ? methodProblem(method, note) : null;
  const chosen = PAYMENT_METHODS.find((m) => m.value === method);

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Pay a supplier</h1><Link className="underline" to="/suppliers">Suppliers</Link></div>
      <div className="space-y-1"><Label htmlFor="sp-sup">Supplier</Label>
        <select id="sp-sup" className={sel} value={supplierId} onChange={(e) => { setConfirming(false); setSupplierId(e.target.value); }}>
          <option value="">Pick a supplier</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {owed !== null && <p className="text-sm text-muted-foreground">{balanceWords(owed, formatNaira)}.</p>}
      </div>
      <div className="space-y-1"><Label htmlFor="sp-amt">Amount paid (₦)</Label><Input id="sp-amt" type="number" min={0} value={amount} onChange={(e) => { setConfirming(false); setAmount(e.target.value); }} /></div>
      <div className="space-y-1"><Label htmlFor="sp-note">{method === "other" ? "Note (required for Other)" : "Note (optional)"}</Label><Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. transfer to Opay" /></div>
      <div className="space-y-1"><Label htmlFor="sp-method">How was it paid?</Label>
        <select id="sp-method" className={sel} value={method} onChange={(e) => { setConfirming(false); setMethod(e.target.value); }}>
          <option value="">Choose how it was paid</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {chosen && <p className="text-xs text-muted-foreground">{chosen.hint}</p>}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>
      {confirming && warning && (
        <div className="space-y-2 rounded-md border border-destructive p-3" data-testid="advance-confirm">
          <p className="font-semibold">This is more than you owe. The supplier will owe you the difference.</p>
          <p className="text-sm">The difference is {formatNaira(warning.extraKobo)}. Check the amount before you go on.</p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={save} disabled={busy}>{busy ? "Saving…" : "Yes, record it"}</Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>Change the amount</Button>
          </div>
        </div>
      )}
      {!confirming && <Button className="w-full" onClick={() => (warning ? setConfirming(true) : save())} disabled={busy || !supplierId || !(Number(amount) > 0) || !method || !!problem}>{busy ? "Saving…" : "Record payment"}</Button>}
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </main>
  );
}
