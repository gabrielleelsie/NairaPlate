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
import { useCateringEnabled } from "@/lib/features";
import { canReverse, describeEntries, entryWhen, methodLabel, reasonOk, type PaymentEntry } from "@/lib/catering-payments";
import { STATUS_LABEL, draftProblem, isOwnerRole, normaliseStatus, orderTotals, statusActions, totalsText, type DraftLine, type OrderStatus } from "@/lib/catering-order";

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
  status: OrderStatus; delivery_address: string | null; notes: string | null; delivery_fee_kobo: number; discount_kobo: number; subtotal_kobo: number;
};
type Item = { id: string; order_id: string; recipe_name: string; quantity: number; unit_price_kobo: number; line_total_kobo: number; is_custom: boolean };
type Dish = { id: string; name: string; selling_price_kobo: number };
const received = (b: Booking) => b.deposit_kobo + b.additional_payments_kobo;
const remaining = (b: Booking) => b.total_contract_kobo - received(b);
const EMPTY = { name: "", phone: "", date: "", time: "", address: "", notes: "", delivery: "", discount: "", deposit: "", depositMethod: "" };
const STATUS_STYLE: Record<OrderStatus, string> = { enquiry: "bg-amber-100 text-amber-900", confirmed: "bg-blue-100 text-blue-900", delivered: "bg-green-100 text-green-900", cancelled: "bg-gray-200 text-gray-700" };

function CateringScreen() {
  const { loading, session } = useStaffSession();
  const feature = useCateringEnabled();
  const [rows, setRows] = useState<Booking[]>([]);
  const [items, setItems] = useState<Map<string, Item[]>>(new Map());
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState({ name: "", qty: "1", price: "" });
  const [bizName, setBizName] = useState("our kitchen");
  const [f, setF] = useState(EMPTY);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("cash");
  const [payments, setPayments] = useState<Map<string, PaymentEntry[]>>(new Map());
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [asEnquiry, setAsEnquiry] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = lagosDateKey(new Date());
  const role = session?.role ?? null;
  const owner = isOwnerRole(role);

  async function load() {
    const { data, error } = await supabase.from("catering_deposits").select("*").order("event_date", { ascending: true });
    if (error) return setMsg({ ok: false, text: "Could not load: " + error.message });
    setRows((data ?? []).map((r) => {
      const x = r as unknown as Booking;
      return {
        ...x, event_time: x.event_time ?? null, status: normaliseStatus(x.status),
        deposit_kobo: Number(x.deposit_kobo), additional_payments_kobo: Number(x.additional_payments_kobo ?? 0), total_contract_kobo: Number(x.total_contract_kobo),
        delivery_fee_kobo: Number(x.delivery_fee_kobo ?? 0), discount_kobo: Number(x.discount_kobo ?? 0), subtotal_kobo: Number(x.subtotal_kobo ?? 0),
      };
    }));
    const { data: li } = await supabase.from("catering_order_items" as never).select("id,order_id,recipe_name,quantity,unit_price_kobo,line_total_kobo,is_custom").order("created_at", { ascending: true });
    const m = new Map<string, Item[]>();
    for (const r of (li ?? []) as unknown as Item[]) {
      const it = { ...r, quantity: Number(r.quantity), unit_price_kobo: Number(r.unit_price_kobo), line_total_kobo: Number(r.line_total_kobo) };
      m.set(it.order_id, [...(m.get(it.order_id) ?? []), it]);
    }
    setItems(m);
    const { data: pe } = await supabase.from("catering_payments" as never).select("id,order_id,kind,amount_kobo,method,reverses_id,reason,carried_over,recorded_by_name,created_at").order("created_at", { ascending: true });
    const pm = new Map<string, PaymentEntry[]>();
    for (const r of (pe ?? []) as unknown as PaymentEntry[]) {
      const x = { ...r, amount_kobo: Number(r.amount_kobo) };
      pm.set(x.order_id, [...(pm.get(x.order_id) ?? []), x]);
    }
    setPayments(pm);
  }
  useEffect(() => { if (session && feature.enabled) load(); }, [session, feature.enabled]);
  useEffect(() => {
    if (!session || !feature.enabled) return;
    supabase.from("businesses").select("name").eq("id", session.businessId).maybeSingle().then(({ data }) => { if (data?.name) setBizName(String(data.name)); });
    supabase.from("recipes").select("id,name,selling_price_kobo").eq("is_current", true).order("name").then(({ data }) => {
      setDishes((data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), selling_price_kobo: Number(r.selling_price_kobo) })));
    });
  }, [session, feature.enabled]);

  const deliveryK = nairaToKobo(f.delivery), discountK = nairaToKobo(f.discount), depK = nairaToKobo(f.deposit);
  const totals = orderTotals({ lines, deliveryKobo: deliveryK, discountKobo: discountK, depositKobo: depK });
  const problem = draftProblem({ role, customer: f.name, date: f.date, time: f.time, today, lines, deliveryKobo: deliveryK, discountKobo: discountK, depositKobo: depK, depositMethod: f.depositMethod });
  const datePast = !!f.date && f.date < today;

  const touch = () => setChecking(false);
  const addDish = () => {
    const d = dishes.find((x) => x.id === pick);
    if (!d) return;
    touch(); setPick("");
    setLines((ls) => {
      const have = ls.find((l) => l.recipeId === d.id);
      return have ? ls.map((l) => (l === have ? { ...l, quantity: l.quantity + 1 } : l))
        : [...ls, { key: crypto.randomUUID(), recipeId: d.id, name: d.name, quantity: 1, unitPriceKobo: d.selling_price_kobo, custom: false }];
    });
  };
  const addCustom = () => {
    const qty = Number(custom.qty), price = nairaToKobo(custom.price);
    if (!custom.name.trim() || !(qty > 0) || !(price >= 0) || custom.price === "") return;
    touch();
    setLines((ls) => [...ls, { key: crypto.randomUUID(), recipeId: null, name: custom.name.trim(), quantity: qty, unitPriceKobo: price, custom: true }]);
    setCustom({ name: "", qty: "1", price: "" });
  };
  const setQty = (key: string, q: number) => { touch(); setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: q } : l))); };
  const removeLine = (key: string) => { touch(); setLines((ls) => ls.filter((l) => l.key !== key)); };

  async function book() {
    if (!session || problem || saving) return;
    setSaving(true);
    // Dish prices are read again by the database; only the dish and the quantity are trusted from this screen.
    const payload = lines.map((l) => (l.custom ? { name: l.name, quantity: l.quantity, unit_price_kobo: l.unitPriceKobo } : { recipe_id: l.recipeId, quantity: l.quantity }));
    const { data, error } = await supabase.rpc("create_catering_order" as never, {
      p_customer: f.name.trim(), p_phone: f.phone.trim(), p_event_date: f.date, p_event_time: f.time, p_address: f.address, p_notes: f.notes,
      p_items: payload, p_delivery_fee_kobo: deliveryK, p_discount_kobo: discountK, p_deposit_kobo: depK, p_deposit_method: depK > 0 ? f.depositMethod : null, p_status: asEnquiry ? "enquiry" : "confirmed",
    } as never);
    setSaving(false); setChecking(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const r = data as { total_kobo: number; balance_kobo: number };
    setMsg({ ok: true, text: `${asEnquiry ? "Enquiry saved" : "Booked"} for ${f.name.trim()}, ${readBack(f.date, f.time)}. Total ${formatNaira(Number(r.total_kobo))}, ${formatNaira(Number(r.balance_kobo))} still to pay.` });
    setF(EMPTY); setLines([]); setAsEnquiry(false); load();
  }

  async function changeStatus(b: Booking, to: "confirmed" | "delivered" | "cancelled") {
    const { error } = await supabase.rpc("set_catering_status" as never, { p_order_id: b.id, p_status: to } as never);
    setConfirmCancel(null);
    if (error) return setMsg({ ok: false, text: "Not changed: " + error.message });
    setMsg({ ok: true, text: `${b.customer_name}'s order is now ${STATUS_LABEL[to].toLowerCase()}.` });
    load();
  }

  async function recordPayment(b: Booking) {
    const amt = nairaToKobo(payAmt);
    if (!(amt > 0)) return;
    // Adds to additional_payments_kobo and flips settled when fully paid — one database step.
    const { data, error } = await supabase.rpc("record_catering_payment_v2" as never, { p_booking_id: b.id, p_amount_kobo: amt, p_method: payMethod } as never);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const r = data as { remaining_kobo: number; settled: boolean };
    setMsg({ ok: true, text: r.settled
      ? `${b.customer_name} is fully paid.${Number(r.remaining_kobo) < 0 ? ` Overpaid by ${formatNaira(-Number(r.remaining_kobo))}.` : ""}`
      : `${formatNaira(amt)} recorded. ${formatNaira(Number(r.remaining_kobo))} still to pay.` });
    setPayFor(null); setPayAmt(""); load();
  }

  async function reversePayment(entryId: string, b: Booking) {
    if (!reasonOk(reverseReason)) return;
    const { data, error } = await supabase.rpc("reverse_catering_payment" as never, { p_payment_id: entryId, p_reason: reverseReason.trim() } as never);
    if (error) return setMsg({ ok: false, text: "Not reversed: " + error.message });
    const r = data as { remaining_kobo: number };
    setMsg({ ok: true, text: `The payment was reversed. ${b.customer_name} now owes ${formatNaira(Math.max(0, Number(r.remaining_kobo)))}.` });
    setReverseFor(null); setReverseReason(""); load();
  }

  if (loading || feature.loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Home</Link></main>;
  if (!feature.enabled)
    return (
      <main className="mx-auto max-w-xl p-6 space-y-3">
        <h1 className="text-2xl font-bold">Catering orders</h1>
        <p>Catering orders are not switched on for your business. If you cater for events or take big orders, ask NairaPlate support to switch them on.</p>
        <Link className="underline" to="/app">Home</Link>
      </main>
    );

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { touch(); setF({ ...f, [k]: e.target.value }); };
  const groups = groupBookings(rows);
  const customReady = custom.name.trim() !== "" && Number(custom.qty) > 0 && custom.price !== "";

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Catering orders</h1><Link className="underline" to="/app">Home</Link></div>

      <section className="rounded-md border p-3 space-y-3">
        <h2 className="font-semibold">New catering order</h2>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-name">Customer name</Label><Input id="k-name" value={f.name} onChange={set("name")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-phone">Phone</Label><Input id="k-phone" type="tel" value={f.phone} onChange={set("phone")} /></div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-date">Event date</Label><Input id="k-date" type="date" min={today} value={f.date} onChange={set("date")} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="k-time">Event time (required)</Label><Input id="k-time" type="time" value={f.time} onChange={set("time")} /></div>
        </div>
        {f.date && <p className="text-sm font-medium" data-testid="date-words">{datePast ? "That date has already passed. Choose today or a later date." : `${longDate(f.date)} (${distanceLabel(daysFromToday(f.date))})`}</p>}
        <div className="space-y-1"><Label htmlFor="k-addr">Delivery address (optional)</Label><Input id="k-addr" value={f.address} onChange={set("address")} /></div>

        <div className="space-y-2 rounded-md bg-muted/40 p-2">
          <Label htmlFor="k-dish">Items from your menu</Label>
          <div className="flex gap-2">
            <select id="k-dish" className="h-9 flex-1 rounded-md border border-input bg-background px-2" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a dish…</option>
              {dishes.map((d) => <option key={d.id} value={d.id}>{d.name} — {formatNaira(d.selling_price_kobo)}</option>)}
            </select>
            <Button type="button" onClick={addDish} disabled={!pick}>Add</Button>
          </div>
          {owner && (
            <div className="space-y-1 pt-1">
              <div className="text-sm font-medium">Something not on your menu (owner only)</div>
              <div className="flex gap-2">
                <Input aria-label="Custom item name" placeholder="e.g. Small chops tray" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                <Input aria-label="Custom item quantity" className="w-16" type="number" min={0} value={custom.qty} onChange={(e) => setCustom({ ...custom, qty: e.target.value })} />
                <Input aria-label="Custom item price each (₦)" className="w-28" type="number" min={0} placeholder="₦ each" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
                <Button type="button" variant="outline" onClick={addCustom} disabled={!customReady}>Add</Button>
              </div>
            </div>
          )}
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : (
            <ul className="space-y-1" data-testid="draft-lines">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{l.name}{l.custom ? " (custom)" : ""} <span className="text-muted-foreground">{formatNaira(l.unitPriceKobo)} each</span></span>
                  <Input aria-label={`Quantity of ${l.name}`} className="w-20" type="number" min={0} value={l.quantity} onChange={(e) => setQty(l.key, Number(e.target.value))} />
                  <span className="w-24 text-right font-medium">{formatNaira(Math.round(l.unitPriceKobo * l.quantity))}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(l.key)} aria-label={`Remove ${l.name}`}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="k-del">Delivery fee (₦)</Label><Input id="k-del" type="number" min={0} value={f.delivery} onChange={set("delivery")} /></div>
          {owner && <div className="flex-1 space-y-1"><Label htmlFor="k-disc">Discount (₦, owner only)</Label><Input id="k-disc" type="number" min={0} value={f.discount} onChange={set("discount")} /></div>}
          <div className="flex-1 space-y-1"><Label htmlFor="k-dep">Deposit paid (₦)</Label><Input id="k-dep" type="number" min={0} value={f.deposit} onChange={set("deposit")} /></div>
        </div>
        {depK > 0 && (
          <div className="space-y-1"><Label htmlFor="k-depm">How was the deposit paid?</Label>
            <select id="k-depm" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.depositMethod} onChange={(e) => { touch(); setF((x) => ({ ...x, depositMethod: e.target.value })); }}>
              <option value="">Choose…</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
            </select>
            <p className="text-xs text-muted-foreground">A cash deposit counts in the cash drawer's expected cash.</p>
          </div>
        )}
        <div className="space-y-1"><Label htmlFor="k-notes">Notes (optional)</Label>
          <textarea id="k-notes" className="w-full min-h-16 rounded-md border border-input bg-background px-3 py-2" value={f.notes} onChange={set("notes")} placeholder="e.g. no pepper in half the jollof" /></div>

        {lines.length > 0 && <p className="text-sm font-medium" data-testid="totals">{totalsText(totals, deliveryK, discountK, depK)}</p>}
        {problem && (f.name || lines.length > 0 || f.date) && <p className="text-sm text-destructive" data-testid="problem">{problem}</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asEnquiry} onChange={(e) => { touch(); setAsEnquiry(e.target.checked); }} /> Only an enquiry for now (not confirmed yet)</label>

        {!checking ? (
          <Button onClick={() => setChecking(true)} disabled={!!problem}>Check and save order</Button>
        ) : (
          <div className="rounded-md border border-primary p-3 space-y-2" data-testid="read-back">
            <p className="text-sm font-semibold">Check before saving</p>
            <p className="text-base">{f.name.trim()}: <strong>{readBack(f.date, f.time)}</strong></p>
            <p className="text-sm">{lines.map((l) => `${l.quantity} x ${l.name}`).join(", ")}</p>
            <p className="text-sm">{totalsText(totals, deliveryK, discountK, depK)}</p>
            <div className="flex gap-2"><Button onClick={book} disabled={saving}>{saving ? "Saving…" : "Yes, save it"}</Button><Button variant="outline" onClick={() => setChecking(false)}>Change something</Button></div>
          </div>
        )}
      </section>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      {rows.length === 0 && <p className="text-muted-foreground">No orders yet.</p>}
      {groups.map((g) => (
        <section key={g.bucket} className="space-y-2" data-testid={`group-${g.bucket}`}>
          <h2 className={`text-lg font-semibold ${g.bucket === "today" || g.bucket === "tomorrow" ? "text-primary" : ""}`}>{BUCKET_LABEL[g.bucket]} ({g.rows.length})</h2>
          <ul className="space-y-2">
            {g.rows.map((b) => {
              const wa = whatsappUrl(b.phone, reminderMessage({ customer: b.customer_name, businessName: bizName, eventDate: b.event_date ?? "", eventTime: b.event_time, balanceKobo: Math.max(0, remaining(b)) }));
              const lineItems = items.get(b.id) ?? [];
              const actions = statusActions(b.status, role);
              return (
                <li key={b.id} className={`rounded-md border p-3 space-y-1 ${b.status === "cancelled" ? "opacity-70" : ""}`} data-testid="booking">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{b.customer_name}</span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[b.status]}`} data-testid="status">{STATUS_LABEL[b.status]}</span>
                      <span className={b.settled ? "text-primary font-semibold" : "text-muted-foreground"}>{b.settled ? "Fully paid" : "Balance owing"}</span>
                    </span>
                  </div>
                  <div className="text-sm font-medium">{b.event_date ? `${longDate(b.event_date)}${b.event_time ? ` at ${timeLabel(b.event_time)}` : " (time not set)"} (${distanceLabel(daysFromToday(b.event_date))})` : "No date"}</div>
                  {b.phone && <div className="text-sm text-muted-foreground">{b.phone}</div>}
                  {b.delivery_address && <div className="text-sm">Deliver to: {b.delivery_address}</div>}
                  {lineItems.length > 0 ? (
                    <ul className="text-sm" data-testid="order-lines">
                      {lineItems.map((it) => <li key={it.id} className="flex justify-between"><span>{it.quantity} x {it.recipe_name}{it.is_custom ? " (custom)" : ""}</span><span>{formatNaira(it.line_total_kobo)}</span></li>)}
                    </ul>
                  ) : b.items_summary && <div className="text-sm">{b.items_summary}</div>}
                  {b.notes && <div className="text-sm text-muted-foreground">Notes: {b.notes}</div>}
                  <div className="text-sm grid grid-cols-2 gap-x-3">
                    {b.delivery_fee_kobo > 0 && <span>Delivery: {formatNaira(b.delivery_fee_kobo)}</span>}
                    {b.discount_kobo > 0 && <span>Discount: -{formatNaira(b.discount_kobo)}</span>}
                    <span>Full price: {formatNaira(b.total_contract_kobo)}</span>
                    <span>Deposit: {formatNaira(b.deposit_kobo)}</span>
                    <span>Received so far: {formatNaira(received(b))}</span>
                    <span className={remaining(b) > 0 ? "font-semibold" : ""}>Still to pay: {formatNaira(Math.max(0, remaining(b)))}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {actions.map((a) => a.to === "cancelled" ? (
                      confirmCancel === b.id ? (
                        <span key={a.to} className="flex items-center gap-2 text-sm">Cancel this order?
                          <Button size="sm" variant="destructive" onClick={() => changeStatus(b, "cancelled")}>Yes, cancel it</Button>
                          <Button size="sm" variant="outline" onClick={() => setConfirmCancel(null)}>No</Button></span>
                      ) : <Button key={a.to} size="sm" variant="outline" onClick={() => setConfirmCancel(b.id)}>{a.label}</Button>
                    ) : <Button key={a.to} size="sm" onClick={() => changeStatus(b, a.to)}>{a.label}</Button>)}
                    {b.status !== "cancelled" && !b.settled && (payFor === b.id ? (
                      <div className="flex gap-2 w-full">
                        <Input aria-label="Payment amount" type="number" min={0} placeholder="Amount ₦" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                        <select aria-label="Payment method" className="h-9 rounded-md border border-input bg-background px-2" value={payMethod} onChange={(e) => setPayMethod(e.target.value as "cash" | "transfer")}><option value="cash">Cash</option><option value="transfer">Transfer</option></select>
                        <Button onClick={() => recordPayment(b)} disabled={!(Number(payAmt) > 0)}>Save</Button>
                        <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
                      </div>
                    ) : <Button size="sm" variant="outline" onClick={() => { setPayFor(b.id); setPayAmt(""); }}>Record balance payment</Button>)}
                    {wa && b.status === "confirmed" && g.bucket !== "past" && <a className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" href={wa} target="_blank" rel="noopener noreferrer">Remind customer on WhatsApp</a>}
                  </div>
                  {(() => {
                    const hist = describeEntries(payments.get(b.id) ?? []);
                    if (hist.length === 0) return null;
                    return (
                      <details className="pt-1" data-testid="payment-history">
                        <summary className="cursor-pointer text-sm font-medium">Payment history ({hist.length})</summary>
                        <ul className="mt-1 space-y-1 text-sm">
                          {hist.map((h) => (
                            <li key={h.id} className="rounded border p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className={h.reversed ? "text-muted-foreground line-through" : ""}>
                                  {h.label}{methodLabel(h.method) ? ` (${methodLabel(h.method)})` : ""}: <strong>{h.amount_kobo < 0 ? "-" : ""}{formatNaira(Math.abs(h.amount_kobo))}</strong>
                                </span>
                                <span className="text-muted-foreground">{entryWhen(h.created_at)}{h.recorded_by_name ? ` · ${h.recorded_by_name}` : ""}</span>
                              </div>
                              {h.carried_over && <div className="text-xs text-muted-foreground">Carried over from before payment history began.</div>}
                              {h.reversed && <div className="text-xs font-semibold text-destructive">Reversed{h.reversedByReason ? `: ${h.reversedByReason}` : ""}</div>}
                              {h.kind === "reversal" && h.reason && <div className="text-xs text-muted-foreground">Reason: {h.reason}</div>}
                              {canReverse(h, role) && (reverseFor === h.id ? (
                                <div className="mt-1 flex flex-wrap gap-2">
                                  <Input aria-label="Reason for reversing" className="flex-1" placeholder="Why is this being reversed? (5 or more characters)" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                                  <Button size="sm" variant="destructive" disabled={!reasonOk(reverseReason)} onClick={() => reversePayment(h.id, b)}>Reverse it</Button>
                                  <Button size="sm" variant="outline" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
                                </div>
                              ) : <Button size="sm" variant="outline" className="mt-1" onClick={() => { setReverseFor(h.id); setReverseReason(""); }}>Reverse</Button>)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
