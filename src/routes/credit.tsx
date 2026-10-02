import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { isOwnerRole } from "@/lib/catering-order";
import {
  CREDIT_ROLES, DEBT_COLUMNS, ENTRY_COLUMNS, STATUS_LABEL, amountProblem, balanceKobo, canReverse, canTakePayment, canWriteOff, debtStatus,
  describeEntries, entryTime, methodLabel, normaliseDebts, normaliseEntries, reasonOk, totalOwed, type CreditEntry, type Debt,
} from "@/lib/credit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/credit")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Customer credit — NairaPlate" },
      { name: "description", content: "Track customers who owe money, record their payments and keep a history of every change." },
      { property: "og:title", content: "Customer credit — NairaPlate" },
      { property: "og:description", content: "Track customers who owe money, record their payments and keep a history of every change." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditScreen,
});

type Action = { id: string; kind: "pay" | "writeoff" | "history" };
const koboToInput = (k: number) => String(k / 100);

function CreditScreen() {
  const { loading, session } = useStaffSession();
  const [rows, setRows] = useState<Debt[]>([]);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [tab, setTab] = useState<"owing" | "settled">("owing");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [amt, setAmt] = useState("");
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [reason, setReason] = useState("");
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = isOwnerRole(session?.role);

  async function load() {
    const [d, e] = await Promise.all([
      supabase.from("customer_credits").select(DEBT_COLUMNS).order("created_at", { ascending: false }),
      supabase.from("credit_payments" as never).select(ENTRY_COLUMNS).order("created_at", { ascending: true }),
    ]);
    if (d.error) return setMsg({ ok: false, text: "Could not load: " + d.error.message });
    if (e.error) return setMsg({ ok: false, text: "Could not load the payment history: " + e.error.message });
    setRows(normaliseDebts(d.data));
    setEntries(normaliseEntries(e.data as unknown[]));
  }
  useEffect(() => { if (session) load(); }, [session]);

  function open(r: Debt, kind: Action["kind"]) {
    setMsg(null); setReverseFor(null); setReverseReason(""); setReason("");
    setAction({ id: r.id, kind });
    setAmt(kind === "history" ? "" : koboToInput(balanceKobo(r))); // the full balance is the default; it can be made smaller
  }
  const close = () => { setAction(null); setAmt(""); setReason(""); setReverseFor(null); setReverseReason(""); };

  // Manual debts are owner-only. Cashiers make credit on the Till.
  async function add() {
    const amount_kobo = nairaToKobo(amount);
    if (!name.trim() || !(amount_kobo > 0) || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("create_manual_credit" as never, { p_customer: name.trim(), p_phone: phone.trim() || null, p_amount_kobo: amount_kobo, p_note: note.trim() || null } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    setMsg({ ok: true, text: `${name.trim()} now owes ${formatNaira(amount_kobo)}.` });
    setName(""); setPhone(""); setAmount(""); setNote(""); load();
  }

  async function pay(r: Debt) {
    const kobo = nairaToKobo(amt);
    const problem = amountProblem(kobo, r);
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true);
    const { data, error } = await supabase.rpc("record_credit_payment" as never, { p_credit_id: r.id, p_amount_kobo: kobo, p_method: method } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const x = data as { balance_kobo: number; settled: boolean };
    setMsg({ ok: true, text: x.settled ? `${r.customer_name} has paid in full.` : `${formatNaira(kobo)} recorded. ${r.customer_name} still owes ${formatNaira(Number(x.balance_kobo))}.` });
    close(); load();
  }

  async function writeOff(r: Debt) {
    const kobo = nairaToKobo(amt);
    const problem = amountProblem(kobo, r);
    if (problem) return setMsg({ ok: false, text: problem });
    if (!reasonOk(reason)) return setMsg({ ok: false, text: "Type a reason of at least 5 characters." });
    setBusy(true);
    const { data, error } = await supabase.rpc("write_off_credit" as never, { p_credit_id: r.id, p_amount_kobo: kobo, p_reason: reason.trim() } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not written off: " + error.message });
    const x = data as { balance_kobo: number };
    setMsg({ ok: true, text: `${formatNaira(kobo)} written off. ${Number(x.balance_kobo) > 0 ? `${formatNaira(Number(x.balance_kobo))} is still owed.` : "Nothing is owed now."}` });
    close(); load();
  }

  async function reverse(entryId: string, r: Debt) {
    if (!reasonOk(reverseReason) || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("reverse_credit_entry" as never, { p_entry_id: entryId, p_reason: reverseReason.trim() } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not reversed: " + error.message });
    const x = data as { balance_kobo: number };
    setMsg({ ok: true, text: `Reversed. ${r.customer_name} now owes ${formatNaira(Number(x.balance_kobo))}.` });
    close(); load();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !CREDIT_ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Home</Link></main>;

  const shown = rows.filter((r) => !r.settled === (tab === "owing"));

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Customer credit</h1><Link className="underline" to="/app">Home</Link></div>

      {isOwner ? (
        <section className="rounded-md border p-3 space-y-2">
          <h2 className="font-semibold">Add a debt by hand</h2>
          <p className="text-sm text-muted-foreground">For money owed that did not come from a till sale. Cashiers add credit on the Till.</p>
          <div className="space-y-1"><Label htmlFor="c-name">Customer name</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="flex-1 space-y-1"><Label htmlFor="c-amount">Amount owed (₦)</Label><Input id="c-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="c-note">What it is for (optional)</Label><Input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button onClick={add} disabled={busy || !name.trim() || !(Number(amount) > 0)}>Add debt</Button>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">To add credit for a customer, use the Till and choose credit. Only an owner can add a debt by hand.</p>
      )}
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <div className="flex gap-2">
        <Button variant={tab === "owing" ? "default" : "outline"} onClick={() => setTab("owing")}>Still owing</Button>
        <Button variant={tab === "settled" ? "default" : "outline"} onClick={() => setTab("settled")}>Settled</Button>
      </div>
      {tab === "owing" && <p className="font-semibold">Total owed to you: {formatNaira(totalOwed(rows))}</p>}

      <ul className="space-y-2" data-testid={`list-${tab}`}>
        {shown.length === 0 && <li className="text-muted-foreground">Nothing here.</li>}
        {shown.map((r) => {
          const left = balanceKobo(r);
          const mine = action?.id === r.id ? action.kind : null;
          const history = describeEntries(entries.filter((e) => e.credit_id === r.id));
          return (
            <li key={r.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{r.customer_name} <span className="text-xs rounded border px-1.5 py-0.5 ml-1">{STATUS_LABEL[debtStatus(r)]}</span></div>
                  <div className="text-sm text-muted-foreground">{r.phone ?? "no phone"}{r.order_id ? " · from a till sale" : ""} · {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                  {r.note && <div className="text-sm text-muted-foreground">{r.note}</div>}
                </div>
                <div className="text-right text-sm">
                  <div>Owed {formatNaira(r.amount_kobo)}</div>
                  {r.paid_kobo > 0 && <div>Paid {formatNaira(r.paid_kobo)}</div>}
                  {r.written_off_kobo > 0 && <div>Written off {formatNaira(r.written_off_kobo)}</div>}
                  <div className="font-semibold">Still owing {formatNaira(left)}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {canTakePayment(r, session.role) && <Button size="sm" onClick={() => open(r, "pay")}>Record payment</Button>}
                {canWriteOff(r, session.role) && <Button size="sm" variant="outline" onClick={() => open(r, "writeoff")}>Write off</Button>}
                {history.length > 0 && <Button size="sm" variant="ghost" onClick={() => (mine === "history" ? close() : open(r, "history"))}>{mine === "history" ? "Hide history" : `History (${history.length})`}</Button>}
              </div>

              {mine === "pay" && (
                <div className="rounded-md bg-muted p-2 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1"><Label htmlFor={`amt-${r.id}`}>Amount received (₦)</Label><Input id={`amt-${r.id}`} type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor={`m-${r.id}`}>How</Label>
                      <select id={`m-${r.id}`} className="h-9 rounded-md border bg-background px-2" value={method} onChange={(e) => setMethod(e.target.value as "cash" | "transfer")}><option value="cash">Cash</option><option value="transfer">Transfer</option></select>
                    </div>
                  </div>
                  <div className="flex gap-2"><Button size="sm" onClick={() => pay(r)} disabled={busy}>Save payment</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
                </div>
              )}

              {mine === "writeoff" && (
                <div className="rounded-md bg-muted p-2 space-y-2">
                  <p className="text-sm">Writing off means you accept you will not be paid. It stays on record with your reason.</p>
                  <div className="space-y-1"><Label htmlFor={`wa-${r.id}`}>Amount to write off (₦)</Label><Input id={`wa-${r.id}`} type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor={`wr-${r.id}`}>Reason (at least 5 characters)</Label><Input id={`wr-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                  <div className="flex gap-2"><Button size="sm" variant="destructive" onClick={() => writeOff(r)} disabled={busy || !reasonOk(reason)}>Write off</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
                </div>
              )}

              {mine === "history" && (
                <ul className="text-sm space-y-1" data-testid={`history-${r.id}`}>
                  {history.map((e) => (
                    <li key={e.id} className="rounded border p-2">
                      <div className="flex justify-between gap-2">
                        <span className={e.reversed ? "line-through text-muted-foreground" : ""}>
                          {e.label} {formatNaira(Math.abs(e.amount_kobo))}{e.kind === "reversal" ? " taken off" : ""}{methodLabel(e.method) ? ` · ${methodLabel(e.method)}` : ""}
                        </span>
                        <span className="text-muted-foreground">{entryTime(e.created_at)}</span>
                      </div>
                      <div className="text-muted-foreground">{e.carried_over ? "Carried over from before payments were recorded" : `by ${e.recorded_by_name ?? "staff"}`}{e.reason && !e.carried_over ? ` · ${e.reason}` : ""}{e.reversed ? ` · reversed: ${e.reversedByReason}` : ""}</div>
                      {canReverse(e, session.role) && (reverseFor === e.id ? (
                        <div className="mt-1 flex gap-2">
                          <Input aria-label="Reason for reversing" placeholder="Reason (at least 5 characters)" value={reverseReason} onChange={(ev) => setReverseReason(ev.target.value)} />
                          <Button size="sm" onClick={() => reverse(e.id, r)} disabled={busy || !reasonOk(reverseReason)}>Reverse</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
                        </div>
                      ) : <Button size="sm" variant="ghost" onClick={() => { setReverseFor(e.id); setReverseReason(""); }}>Reverse this</Button>)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
