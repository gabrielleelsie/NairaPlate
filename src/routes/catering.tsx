import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUCKET_LABEL, daysFromToday, distanceLabel, groupBookings, longDate, readBack, reminderMessage, timeLabel, whatsappUrl } from "@/lib/catering";
import { lagosDateKey } from "@/lib/lagos-time";

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
  id: string; customer_name: string; phone: string | null; event_date: string | null; event_time: string | null;
  deposit_kobo: number; additional_payments_kobo: number; total_contract_kobo: number;
  items_summary: string | null; settled: boolean;
};
const received = (b: Booking) => b.deposit_kobo + b.additional_payments_kobo;
const remaining = (b: Booking) => b.total_contract_kobo - received(b);
const EMPTY = { name: "", phone: "", date: "", time: "", total: "", deposit: "", items: "" };

function CateringScreen() {
  const { loading, session } = useStaffSession();
  const [rows, setRows] = useState<Booking[]>([]);
  const [bizName, setBizName] = useState("our kitchen");
  const [f, setF] = useState(EMPTY);
  const [checking, setChecking] = useState(false);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = lagosDateKey(new Date());

  async function load() {
    const { data, error } = await supabase.from("catering_deposits").select("*").order("event_date", { ascending: true });
    if (error) return setMsg({ ok: false, text: "Could not load: " + error.message });
    setRows((data ?? []).map((r) => {
      const x = r as unknown as Booking;
      return { ...x, event_time: x.event_time ?? null, deposit_kobo: Number(x.deposit_kobo), additional_payments_kobo: Number(x.additional_payments_kobo ?? 0), total_contract_kobo: Number(x.total_contract_kobo) };
    }));
  }
  useEffect(() => { if (session) load(); }, [session]);
  useEffect(() => {
    if (!session) return;
    supabase.from("businesses").select("name").eq("id", session.businessId).maybeSingle().then(({ data }) => { if (data?.name) setBizName(String(data.name)); });
  }, [session]);

  const totalK = nairaToKobo(f.total), depK = nairaToKobo(f.deposit);
  const datePast = !!f.date && f.date < today;
  const formOk = f.name.trim() && f.date && !datePast && f.time && totalK > 0 && depK >= 0 && depK <= totalK;

  async function book() {
    if (!session || !formOk) return;
    const { error } = await supabase.from("catering_deposits").insert({
      business_id: session.businessId, customer_name: f.name.trim(), phone: f.phone.trim() || null,
      event_date: f.date, event_time: f.time, total_contract_kobo: totalK, deposit_kobo: depK,
      items_summary: f.items.trim() || null, settled: depK >= totalK,
    });
    setChecking(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `Booked ${f.name.trim()} for ${readBack(f.date, f.time)}. ${formatNaira(totalK - depK)} still to pay.` });
    setF(EMPTY); load();
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
    return <main className="p-6 space-y-2"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Home</Link></main>;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setChecking(false); setF({ ...f, [k]: e.target.value }); };
  const groups = groupBookings(rows);

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Catering bookings</h1><Link className="underline" to="/app">Home</Link></div>

      <section className="rounded-md border p-3 space-y-2">
        <h2 className="font-semibold">New catering booking</h2>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-name">Customer name</Label><Input id="k-name" value={f.name} onChange={set("name")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-phone">Phone</Label><Input id="k-phone" type="tel" value={f.phone} onChange={set("phone")} /></div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-date">Event date</Label><Input id="k-date" type="date" min={today} value={f.date} onChange={set("date")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-time">Event time (required)</Label><Input id="k-time" type="time" value={f.time} onChange={set("time")} /></div>
        </div>
        {f.date && <p className="text-sm font-medium" data-testid="date-words">{datePast ? "That date has already passed. Choose today or a later date." : `${longDate(f.date)} (${distanceLabel(daysFromToday(f.date))})`}</p>}
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-total">Full price (₦)</Label><Input id="k-total" type="number" min={0} value={f.total} onChange={set("total")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-dep">Deposit paid (₦)</Label><Input id="k-dep" type="number" min={0} value={f.deposit} onChange={set("deposit")} /></div>
        </div>
        {depK > totalK && totalK > 0 && <p className="text-sm text-destructive">Deposit can't be more than the full price.</p>}
        <div className="space-y-1"><Label htmlFor="k-items">What's being catered</Label>
          <textarea id="k-items" className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2" value={f.items} onChange={set("items")} placeholder="e.g. 100 plates jollof, 100 chicken, 2 coolers small chops" /></div>
        {!checking ? (
          <Button onClick={() => setChecking(true)} disabled={!formOk}>Check and save booking</Button>
        ) : (
          <div className="rounded-md border border-primary p-3 space-y-2" data-testid="read-back">
            <p className="text-sm font-semibold">Check before saving</p>
            <p className="text-base">{f.name.trim()}: <strong>{readBack(f.date, f.time)}</strong></p>
            <p className="text-sm">Full price {formatNaira(totalK)}, deposit {formatNaira(depK)}, still to pay {formatNaira(totalK - depK)}.</p>
            <div className="flex gap-2"><Button onClick={book}>Yes, save it</Button><Button variant="outline" onClick={() => setChecking(false)}>Change something</Button></div>
          </div>
        )}
      </section>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      {rows.length === 0 && <p className="text-muted-foreground">No bookings yet.</p>}
      {groups.map((g) => (
        <section key={g.bucket} className="space-y-2" data-testid={`group-${g.bucket}`}>
          <h2 className={`text-lg font-semibold ${g.bucket === "today" || g.bucket === "tomorrow" ? "text-primary" : ""}`}>{BUCKET_LABEL[g.bucket]} ({g.rows.length})</h2>
          <ul className="space-y-2">
            {g.rows.map((b) => {
              const wa = whatsappUrl(b.phone, reminderMessage({ customer: b.customer_name, businessName: bizName, eventDate: b.event_date ?? "", eventTime: b.event_time, balanceKobo: Math.max(0, remaining(b)) }));
              return (
                <li key={b.id} className="rounded-md border p-3 space-y-1" data-testid="booking">
                  <div className="flex justify-between">
                    <span className="font-medium">{b.customer_name}</span>
                    <span className={b.settled ? "text-primary font-semibold" : "text-muted-foreground"}>{b.settled ? "Fully paid" : "Balance owing"}</span>
                  </div>
                  <div className="text-sm font-medium">{b.event_date ? `${longDate(b.event_date)}${b.event_time ? ` at ${timeLabel(b.event_time)}` : " (time not set)"} (${distanceLabel(daysFromToday(b.event_date))})` : "No date"}</div>
                  {b.phone && <div className="text-sm text-muted-foreground">{b.phone}</div>}
                  {b.items_summary && <div className="text-sm">{b.items_summary}</div>}
                  <div className="text-sm grid grid-cols-2 gap-x-3">
                    <span>Full price: {formatNaira(b.total_contract_kobo)}</span>
                    <span>Deposit: {formatNaira(b.deposit_kobo)}</span>
                    <span>Received so far: {formatNaira(received(b))}</span>
                    <span className={remaining(b) > 0 ? "font-semibold" : ""}>Still to pay: {formatNaira(Math.max(0, remaining(b)))}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!b.settled && (payFor === b.id ? (
                      <div className="flex gap-2 w-full">
                        <Input aria-label="Payment amount" type="number" min={0} placeholder="Amount ₦" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                        <Button onClick={() => recordPayment(b)} disabled={!(Number(payAmt) > 0)}>Save</Button>
                        <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
                      </div>
                    ) : <Button size="sm" variant="outline" onClick={() => { setPayFor(b.id); setPayAmt(""); }}>Record balance payment</Button>)}
                    {wa && g.bucket !== "past" && <a className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" href={wa} target="_blank" rel="noopener noreferrer">Remind customer on WhatsApp</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
