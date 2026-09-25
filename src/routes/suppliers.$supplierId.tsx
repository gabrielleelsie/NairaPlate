import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { SUPPLIER_ROLES, normaliseTxns, supplierBalance, withRunningBalance, type SupplierTxn } from "@/lib/suppliers";
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

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [s, t] = await Promise.all([
        supabase.from("suppliers").select("name,phone,notes").eq("id", supplierId).maybeSingle(),
        supabase.from("supplier_transactions").select("id,supplier_id,type,amount_kobo,purchase_id,note,created_at").eq("supplier_id", supplierId),
      ]);
      if (s.error || !s.data) return setErr("Supplier not found.");
      setSup(s.data); setTxns(normaliseTxns(t.data));
    })();
  }, [session, supplierId]);

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !SUPPLIER_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Purchasers and owners only.</p><Link className="underline" to="/">Home</Link></main>;
  if (err) return <main className="p-6 space-y-2"><p>{err}</p><Link className="underline" to="/suppliers">Back to suppliers</Link></main>;
  if (!sup) return <main className="p-6">Loading…</main>;

  const lines = withRunningBalance(txns);
  const bal = supplierBalance(txns, supplierId);

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">{sup.name}</h1><Link className="underline" to="/suppliers">All suppliers</Link></div>
      <p className="text-sm text-muted-foreground">{sup.phone ?? "no phone"}{sup.notes ? ` · ${sup.notes}` : ""}</p>
      <div className="flex justify-between items-center rounded-md border p-3">
        <span>You owe now</span>
        <span className={bal > 0 ? "text-xl font-bold text-destructive" : "text-xl font-bold"} data-testid="balance">{formatNaira(bal)}</span>
      </div>
      <Button asChild variant="outline"><Link to="/supplier-payment" search={{ supplier: supplierId }}>Record a payment</Link></Button>

      <ul className="space-y-2" data-testid="history">
        {lines.length === 0 && <li className="text-muted-foreground">No credit purchases or payments yet.</li>}
        {lines.map((t) => (
          <li key={t.id} className="flex justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">{t.type === "payment" ? "Payment made" : "Bought on credit"}</div>
              <div className="text-sm text-muted-foreground">
                {new Date(t.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {t.note ? ` · ${t.note}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{t.type === "payment" ? "−" : "+"}{formatNaira(t.amount_kobo)}</div>
              <div className="text-xs text-muted-foreground">owed after: {formatNaira(t.balance_after)}</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
