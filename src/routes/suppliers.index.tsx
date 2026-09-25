import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { SUPPLIER_ROLES, normaliseTxns, supplierBalance, type SupplierTxn } from "@/lib/suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/suppliers/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Suppliers — NairaPlate" },
      { name: "description", content: "See every supplier and how much you owe each one." },
      { property: "og:title", content: "Suppliers — NairaPlate" },
      { property: "og:description", content: "See every supplier and how much you owe each one." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuppliersScreen,
});

type Supplier = { id: string; name: string; phone: string | null; notes: string | null };

function SuppliersScreen() {
  const { loading, session } = useStaffSession();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [txns, setTxns] = useState<SupplierTxn[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [s, t] = await Promise.all([
      supabase.from("suppliers").select("id,name,phone,notes").order("name"),
      supabase.from("supplier_transactions").select("id,supplier_id,type,amount_kobo,purchase_id,note,created_at"),
    ]);
    if (s.error) return setMsg({ ok: false, text: "Could not load: " + s.error.message });
    setSuppliers((s.data ?? []) as Supplier[]);
    setTxns(normaliseTxns(t.data));
  }
  useEffect(() => { if (session) load(); }, [session]);

  async function add() {
    if (!session || !name.trim()) return;
    const { error } = await supabase.from("suppliers").insert({
      business_id: session.businessId, name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null,
    });
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `${name.trim()} added.` });
    setName(""); setPhone(""); setNotes(""); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !SUPPLIER_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Purchasers and owners only.</p><Link className="underline" to="/">Home</Link></main>;

  const total = suppliers.reduce((s, x) => s + supplierBalance(txns, x.id), 0);

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Suppliers</h1><Link className="underline" to="/">Home</Link></div>

      <section className="rounded-md border p-3 space-y-2">
        <h2 className="font-semibold">Add a supplier</h2>
        <div className="space-y-1"><Label htmlFor="s-name">Name</Label><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="s-phone">Phone</Label><Input id="s-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="s-notes">Notes</Label><Input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Mile 12 market, sells garri and beans" /></div>
        <Button onClick={add} disabled={!name.trim()}>Add supplier</Button>
      </section>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <div className="flex justify-between items-center">
        <p className="font-semibold">You owe suppliers: {formatNaira(total)}</p>
        <Button asChild variant="outline" size="sm"><Link to="/supplier-payment">Record supplier payment</Link></Button>
      </div>

      <ul className="space-y-2" data-testid="supplier-list">
        {suppliers.length === 0 && <li className="text-muted-foreground">No suppliers yet.</li>}
        {suppliers.map((s) => {
          const bal = supplierBalance(txns, s.id);
          return (
            <li key={s.id}>
              <Link to="/suppliers/$supplierId" params={{ supplierId: s.id }} className="flex items-center justify-between rounded-md border p-3 hover:bg-accent">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-sm text-muted-foreground">{s.phone ?? "no phone"}</div>
                </div>
                <div className="text-right">
                  <div className={bal > 0 ? "font-semibold text-destructive" : "font-semibold"}>{formatNaira(bal)}</div>
                  <div className="text-xs text-muted-foreground">{bal > 0 ? "you owe" : bal < 0 ? "overpaid" : "all clear"}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
