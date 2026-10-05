import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { ReceiptPhotos } from "@/components/ReceiptPhotos";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { SUPPLIER_ROLES, TXN_COLUMNS, balanceWords, canReverse, methodLabel, normaliseTxns, reasonOk, reversalOf, supplierBalance, withRunningBalance, type SupplierTxn } from "@/lib/suppliers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/suppliers/$supplierId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Supplier history — NairaPlate" },
      { name: "description", content: "Every credit purchase and payment with one supplier, with the balance after each." },
      { property: "og:title", content: "Supplier history — NairaPlate" },
      { property: "og:description", content: "Every credit purchase and payment with one supplier, with the balance after each." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierDetail,
});

function SupplierDetail() {
  const { supplierId } = Route.useParams();
  const { loading, session } = useStaffSession();
  const [sup, setSup] = useState<{ name: string; phone: string | null; notes: string | null } | null>(null);
  const [txns, setTxns] = useState<SupplierTxn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [s, t] = await Promise.all([
      supabase.from("suppliers").select("name,phone,notes").eq("id", supplierId).maybeSingle(),
      supabase.from("supplier_transactions").select(TXN_COLUMNS).eq("supplier_id", supplierId),
    ]);
    if (s.error || !s.data) return setErr("Supplier not found.");
    setSup(s.data); setTxns(normaliseTxns(t.data));
  }
  useEffect(() => { if (session) load(); }, [session, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reverse(id: string) {
    if (!reasonOk(reason)) return;
    const { data, error } = await supabase.rpc("reverse_supplier_payment" as never, { p_payment_id: id, p_reason: reason.trim() } as never);
    if (error) return setMsg({ ok: false, text: "Not reversed: " + error.message });
    setMsg({ ok: true, text: `The payment was reversed. ${balanceWords(Number((data as { balance_kobo: number }).balance_kobo), formatNaira)} now.` });
    setReverseFor(null); setReason(""); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !SUPPLIER_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Purchasers and owners only.</p><Link className="underline" to="/app">Home</Link></main>;
  if (err) return <main className="p-6 space-y-2"><p>{err}</p><Link className="underline" to="/suppliers">Back to suppliers</Link></main>;
  if (!sup) return <main className="p-6">Loading…</main>;

  const lines = withRunningBalance(txns);
  const bal = supplierBalance(txns, supplierId);
  const undone = reversalOf(txns);
  const role = session.role;

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">{sup.name}</h1><Link className="underline" to="/suppliers">All suppliers</Link></div>
      <p className="text-sm text-muted-foreground">{sup.phone ?? "no phone"}{sup.notes ? ` · ${sup.notes}` : ""}</p>
      <div className="flex justify-between items-center rounded-md border p-3">
        <span>{bal < 0 ? "They owe you" : "You owe now"}</span>
        <span className={bal > 0 ? "text-xl font-bold text-destructive" : "text-xl font-bold"} data-testid="balance">{formatNaira(Math.abs(bal))}</span>
      </div>
      <Button asChild variant="outline"><Link to="/supplier-payment" search={{ supplier: supplierId }}>Record a payment</Link></Button>

      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
      <ul className="space-y-2" data-testid="history">
        {lines.length === 0 && <li className="text-muted-foreground">No credit purchases or payments yet.</li>}
        {lines.map((t) => {
          const reversed = undone.get(t.id);
          const label = t.type === "payment" ? "Payment made" : t.type === "reversal" ? "Payment reversed" : t.type === "purchase_reversal" ? "Purchase reversed" : "Bought on credit";
          const sign = t.type === "payment" || t.type === "purchase_reversal" ? "−" : "+";
          return (
            <li key={t.id} className="rounded-md border p-3 space-y-1">
              <div className="flex justify-between">
                <div>
                  <div className={`font-medium ${reversed ? "text-muted-foreground line-through" : ""}`}>{label}</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(t.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {t.type === "payment" ? ` · ${methodLabel(t.payment_method)}` : ""}{t.note ? ` · ${t.note}` : ""}{t.recorded_by_name ? ` · ${t.recorded_by_name}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${reversed ? "text-muted-foreground line-through" : ""}`}>{sign}{formatNaira(t.amount_kobo)}</div>
                  <div className="text-xs text-muted-foreground">balance after: {t.balance_after < 0 ? `they owe you ${formatNaira(-t.balance_after)}` : `you owe ${formatNaira(t.balance_after)}`}</div>
                </div>
              </div>
              {reversed && <div className="text-xs font-semibold text-destructive">Reversed: {reversed.reason}</div>}
              {t.type === "payment" && <ReceiptPhotos type="supplier_payment" recordId={t.id} businessId={session.businessId} role={session.role} />}
              {(t.type === "reversal" || t.type === "purchase_reversal") && t.reason && <div className="text-xs text-muted-foreground">Reason: {t.reason}</div>}
              {canReverse(t, role, undone) && (reverseFor === t.id ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Input aria-label="Reason for reversing" className="flex-1" placeholder="Why is this being reversed? (5 or more characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="destructive" disabled={!reasonOk(reason)} onClick={() => reverse(t.id)}>Reverse it</Button>
                  <Button size="sm" variant="outline" onClick={() => { setReverseFor(null); setReason(""); }}>Cancel</Button>
                </div>
              ) : <Button size="sm" variant="outline" onClick={() => { setReverseFor(t.id); setReason(""); }}>Reverse</Button>)}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
