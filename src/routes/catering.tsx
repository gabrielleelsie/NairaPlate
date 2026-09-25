import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/catering")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Catering bookings — NairaPlate" },
      { name: "description", content: "Book catering events, take deposits and track what's still owed." },
      { property: "og:title", content: "Catering bookings — NairaPlate" },
      { property: "og:description", content: "Book catering events, take deposits and track what's still owed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CateringScreen,
});

const ROLES = new Set(["cashier", "owner", "supa_admin"]);
type Booking = {
  id: string; customer_name: string; phone: string | null; event_date: string | null;
  deposit_kobo: number; additional_payments_kobo: number; total_contract_kobo: number;
  items_summary: string | null; settled: boolean;
};
const received = (b: Booking) => b.deposit_kobo + b.additional_payments_kobo;
const remaining = (b: Booking) => b.total_contract_kobo - received(b);

function CateringScreen() {
  const { loading, session } = useStaffSession();
  const [rows, setRows] = useState<Booking[]>([]);
  const [f, setF] = useState({ name: "", phone: "", date: "", total: "", deposit: "", items: "" });
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data, error } = await supabase.from("catering_deposits").select("*").order("event_date", { ascending: true });
    if (error) return setMsg({ ok: false, text: "Could not load: " + error.message });
    setRows((data ?? []).map((r) => {
      const x = r as unknown as Booking;
      return { ...x, deposit_kobo: Number(x.deposit_kobo), additional_payments_kobo: Number(x.additional_payments_kobo ?? 0), total_contract_kobo: Number(x.total_contract_kobo) };
    }));
  }
  useEffect(() => { if (session) load(); }, [session]);

  const totalK = nairaToKobo(f.total), depK = nairaToKobo(f.deposit);
  const formOk = f.name.trim() && f.date && totalK > 0 && depK >= 0 && depK <= totalK;

  async function book() {
    if (!session || !formOk) return;
    const { error } = await supabase.from("catering_deposits").insert({
      business_id: session.businessId, customer_name: f.name.trim(), phone: f.phone.trim() || null,
      event_date: f.date, total_contract_kobo: totalK, deposit_kobo: depK,
      items_summary: f.items.trim() || null, settled: depK >= totalK,
    });
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `Booked ${f.name.trim()} — ${formatNaira(totalK - depK)} still to pay.` });
    setF({ name: "", phone: "", date: "", total: "", deposit: "", items: "" }); load();
  }

  async function recordPayment(b: Booking) {
    const amt = nairaToKobo(payAmt);
    if (!(amt > 0)) return;
    // Adds to additional_payments_kobo and flips settled when fully paid — one database step.
    const { data, error } = await supabase.rpc("record_catering_payment" as never, { p_booking_id: b.id, p_amount_kobo: amt } as never);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const r = data as { remaining_kobo: number; settled: boolean };
    setMsg({ ok: true, text: r.settled
      ? `${b.customer_name} is fully paid.${Number(r.remaining_kobo) < 0 ? ` Overpaid by ${formatNaira(-Number(r.remaining_kobo))}.` : ""}`
      : `${formatNaira(amt)} recorded. ${formatNaira(Number(r.remaining_kobo))} still to pay.` });
    setPayFor(null); setPayAmt(""); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Cashiers and owners only.</p><Link className="underline" to="/">Home</Link></main>;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Catering bookings</h1><Link className="underline" to="/">Home</Link></div>

      <section className="rounded-md border p-3 space-y-2">
        <h2 className="font-semibold">New catering booking</h2>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-name">Customer name</Label><Input id="k-name" value={f.name} onChange={set("name")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-phone">Phone</Label><Input id="k-phone" type="tel" value={f.phone} onChange={set("phone")} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="k-date">Event date</Label><Input id="k-date" type="date" value={f.date} onChange={set("date")} /></div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-total">Full price (₦)</Label><Input id="k-total" type="number" min={0} value={f.total} onChange={set("total")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-dep">Deposit paid (₦)</Label><Input id="k-dep" type="number" min={0} value={f.deposit} onChange={set("deposit")} /></div>
        </div>
        {depK > totalK && totalK > 0 && <p className="text-sm text-destructive">Deposit can't be more than the full price.</p>}
        <div className="space-y-1"><Label htmlFor="k-items">What's being catered</Label>
          <textarea id="k-items" className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2" value={f.items} onChange={set("items")} placeholder="e.g. 100 plates jollof, 100 chicken, 2 coolers small chops" /></div>
        <Button onClick={book} disabled={!formOk}>Save booking</Button>
      </section>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <ul className="space-y-2">
        {rows.length === 0 && <li className="text-muted-foreground">No bookings yet.</li>}
        {rows.map((b) => (
          <li key={b.id} className="rounded-md border p-3 space-y-1" data-testid="booking">
            <div className="flex justify-between">
              <span className="font-medium">{b.customer_name}</span>
              <span className={b.settled ? "text-primary font-semibold" : "text-muted-foreground"}>{b.settled ? "Fully paid" : "Balance owing"}</span>
            </div>
            <div className="text-sm text-muted-foreground">{b.event_date ? new Date(b.event_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date"}{b.phone ? ` · ${b.phone}` : ""}</div>
            {b.items_summary && <div className="text-sm">{b.items_summary}</div>}
            <div className="text-sm grid grid-cols-2 gap-x-3">
              <span>Full price: {formatNaira(b.total_contract_kobo)}</span>
              <span>Deposit: {formatNaira(b.deposit_kobo)}</span>
              <span>Received so far: {formatNaira(received(b))}</span>
              <span className={remaining(b) > 0 ? "font-semibold" : ""}>Still to pay: {formatNaira(Math.max(0, remaining(b)))}</span>
            </div>
            {!b.settled && (payFor === b.id ? (
              <div className="flex gap-2 pt-1">
                <Input aria-label="Payment amount" type="number" min={0} placeholder="Amount ₦" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                <Button onClick={() => recordPayment(b)} disabled={!(Number(payAmt) > 0)}>Save</Button>
                <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
              </div>
            ) : <Button size="sm" variant="outline" onClick={() => { setPayFor(b.id); setPayAmt(""); }}>Record balance payment</Button>)}
          </li>
        ))}
      </ul>
    </main>
  );
}
