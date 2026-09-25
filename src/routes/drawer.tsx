import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/drawer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cash drawer — NairaPlate" },
      { name: "description", content: "Open and close a cashier shift and check the cash count." },
      { property: "og:title", content: "Cash drawer — NairaPlate" },
      { property: "og:description", content: "Open and close a cashier shift and check the cash count." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrawerScreen,
});

type Drawer = { id: string; opening_float_kobo: number; opened_at: string };
type Summary = { opening_float_kobo: number; expected_cash_kobo: number; closing_counted_kobo: number; discrepancy_kobo: number };
const ROLES = new Set(["cashier", "owner", "supa_admin"]);

function DrawerScreen() {
  const { loading, session } = useStaffSession();
  const [open, setOpen] = useState<Drawer | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("cash_drawers").select("id,opening_float_kobo,opened_at")
      .eq("business_id", session.businessId).eq("opened_by", session.userId).eq("status", "open")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    setOpen(data ? { ...data, opening_float_kobo: Number(data.opening_float_kobo) } : null);
  }, [session]);
  useEffect(() => { load(); }, [load]);

  async function openShift() {
    if (!session || amount === "" || Number(amount) < 0) return setErr("Enter the float in naira.");
    setBusy(true); setErr("");
    const { error } = await supabase.from("cash_drawers").insert({
      business_id: session.businessId, opened_by: session.userId,
      opening_float_kobo: nairaToKobo(amount), status: "open",
    });
    setBusy(false);
    if (error) return setErr("Could not open shift: " + error.message);
    setAmount(""); setSummary(null); load();
  }

  async function closeShift() {
    if (amount === "" || Number(amount) < 0) return setErr("Enter the cash you counted in naira.");
    setBusy(true); setErr("");
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/public/cash-drawer-close", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
      body: JSON.stringify({ closing_counted_kobo: nairaToKobo(amount) }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "Could not close shift.");
    setSummary(body); setAmount(""); load();
  }

  if (loading || open === undefined) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Cashiers and owners only.</p><Link className="underline" to="/">Back</Link></main>;

  const d = summary?.discrepancy_kobo ?? 0;
  return (
    <main className="mx-auto max-w-md p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Cash drawer</h1><Link className="underline" to="/">Home</Link></div>

      {summary && (
        <section className="rounded-lg border p-4 space-y-1" aria-label="Shift summary">
          <h2 className="font-semibold">Shift closed</h2>
          <p>Opening float: {formatNaira(summary.opening_float_kobo)}</p>
          <p>Expected cash: {formatNaira(summary.expected_cash_kobo)}</p>
          <p>Counted cash: {formatNaira(summary.closing_counted_kobo)}</p>
          <p className={d === 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
            {d === 0 ? "Balanced — ₦0.00" : d < 0 ? `Shortage: −${formatNaira(-d)}` : `Overage: +${formatNaira(d)}`}
          </p>
          {d !== 0 && <p className="text-sm text-muted-foreground">The owner has been alerted.</p>}
        </section>
      )}

      {open ? (
        <section className="space-y-2">
          <p>Shift open since {new Date(open.opened_at).toLocaleTimeString()} with a {formatNaira(open.opening_float_kobo)} float.</p>
          <Label htmlFor="amt">Cash counted in drawer (₦)</Label>
          <Input id="amt" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" disabled={busy} onClick={closeShift}>Close shift</Button>
        </section>
      ) : (
        <section className="space-y-2">
          <Label htmlFor="amt">Opening float (₦)</Label>
          <Input id="amt" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" disabled={busy} onClick={openShift}>Open shift</Button>
        </section>
      )}
      {err && <p className="text-destructive">{err}</p>}
    </main>
  );
}
