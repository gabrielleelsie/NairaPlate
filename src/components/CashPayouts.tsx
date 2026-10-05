import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { entryWhen } from "@/lib/catering-payments";
import {
  DEFAULT_PAYOUT_LIMIT_KOBO, PAYOUT_CATEGORIES, PAYOUT_COLUMNS, STATUS_LABEL, canDecide, canReversePayout, canTakeCashOut, cashierDirectTotalKobo, categoryLabel,
  classifyPayout, friendlyPayoutError, netPayoutsKobo, noteOk, normalisePayouts, payoutViews, pendingRequests, remainingAllowanceKobo, type PayoutRow,
} from "@/lib/cash-payouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReceiptPhotos } from "@/components/ReceiptPhotos";

const sel = "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

/** Cash taken out of the open shift: record it, ask the owner when it is over the limit, and (owners) approve, decline, reverse and set the limit. */
export function CashPayouts({ drawerId, role, canRecord, onPending, businessId }: { drawerId: string; role: string; businessId: string; canRecord: boolean; onPending: (n: number) => void }) {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [limit, setLimit] = useState(DEFAULT_PAYOUT_LIMIT_KOBO);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("market_run");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [limitInput, setLimitInput] = useState("");

  const owner = canDecide(role);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      supabase.from("cash_drawer_payouts" as never).select(PAYOUT_COLUMNS).eq("drawer_id", drawerId).order("created_at", { ascending: true }),
      supabase.from("drawer_settings" as never).select("payout_limit_kobo").maybeSingle(),
    ]);
    const list = normalisePayouts(p.data as unknown[] | null);
    setRows(list);
    onPending(pendingRequests(list).length);
    const l = (s.data as { payout_limit_kobo?: number | string } | null)?.payout_limit_kobo;
    setLimit(l == null ? DEFAULT_PAYOUT_LIMIT_KOBO : Number(l));
  }, [drawerId, onPending]);
  useEffect(() => { void load(); }, [load]);

  const views = payoutViews(rows);
  const waiting = pendingRequests(rows);
  const directTotal = cashierDirectTotalKobo(rows);
  const amountKobo = nairaToKobo(amount);
  const choice = classifyPayout({ role, limitKobo: limit, directTotalKobo: directTotal, amountKobo });
  const formOk = amountKobo > 0 && noteOk(note) && !busy;

  async function call(fn: string, args: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn as never, args as never);
    setBusy(false);
    if (error) { setMsg({ ok: false, text: friendlyPayoutError(error.message) }); return null; }
    setMsg({ ok: true, text: done });
    await load();
    return data;
  }

  async function submit() {
    if (!formOk) return;
    const data = await call("record_cash_payout", { p_amount_kobo: amountKobo, p_category: category, p_note: note.trim() }, "");
    if (!data) return;
    const status = (data as { status?: string }).status;
    setMsg({ ok: true, text: status === "requested" ? "That is over your limit for this shift, so it is waiting for the owner to approve. The cash is not counted as paid out until they do." : `${formatNaira(amountKobo)} recorded as taken out of the drawer.` });
    setAmount(""); setNote("");
  }

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Cash taken out of the drawer" data-testid="cash-payouts">
      <div className="flex justify-between gap-2">
        <h2 className="font-semibold">Cash taken out</h2>
        <span className="text-sm">{formatNaira(netPayoutsKobo(rows))} so far</span>
      </div>

      {canRecord && canTakeCashOut(role) && (
        <div className="space-y-2">
          {!owner && <p className="text-xs text-muted-foreground">You can take out up to {formatNaira(remainingAllowanceKobo(limit, directTotal))} more on this shift without asking the owner (the limit is {formatNaira(limit)} in total).</p>}
          <div className="flex gap-2">
            <div className="flex-1 space-y-1"><Label htmlFor="po-amount">Amount (₦)</Label><Input id="po-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="flex-1 space-y-1"><Label htmlFor="po-cat">What for</Label>
              <select id="po-cat" className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
                {PAYOUT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="po-note">Note (at least 5 characters)</Label><Input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. tomatoes and pepper from the market" /></div>
          <Button className="w-full" disabled={!formOk} onClick={submit}>{choice === "request" ? "Ask the owner" : "Take cash out"}</Button>
          {choice === "request" && amountKobo > 0 && <p className="text-xs text-muted-foreground">This is more than you can take out on this shift without asking, so it will go to the owner.</p>}
        </div>
      )}
      {msg && msg.text && <p className={msg.ok ? "text-primary text-sm" : "text-destructive text-sm"} role="status">{msg.text}</p>}

      {owner && waiting.length > 0 && (
        <div className="space-y-2" data-testid="waiting-requests">
          <h3 className="text-sm font-semibold">Waiting for your approval</h3>
          {waiting.map((r) => (
            <div key={r.id} className="rounded-md border p-2 text-sm space-y-1">
              <div className="flex justify-between"><span>{r.recorded_by_name ?? "A cashier"} · {categoryLabel(r.category)}</span><span className="font-medium">{formatNaira(r.amount_kobo)}</span></div>
              <div className="text-muted-foreground">{r.note}</div>
              {declineFor === r.id ? (
                <div className="space-y-2 rounded-md bg-muted p-2">
                  <Label htmlFor={`dec-${r.id}`}>Reason (at least 5 characters)</Label>
                  <Input id={`dec-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={busy || !noteOk(reason)} onClick={async () => { if (await call("decline_cash_payout", { p_request_id: r.id, p_reason: reason.trim() }, "Declined. Nothing was taken off the expected cash.")) { setDeclineFor(null); setReason(""); } }}>Decline this request</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDeclineFor(null); setReason(""); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => call("approve_cash_payout", { p_request_id: r.id }, "Approved. It now counts as paid out of the drawer.")}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDeclineFor(r.id); setReason(""); setMsg(null); }}>Decline</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!owner && waiting.length > 0 && <p className="text-sm">{waiting.length} request{waiting.length === 1 ? " is" : "s are"} waiting for the owner. The shift cannot be closed until they decide.</p>}

      <ul className="space-y-2" data-testid="payout-list">
        {views.length === 0 && <li className="text-sm text-muted-foreground">Nothing taken out on this shift yet.</li>}
        {views.map((v) => (
          <li key={v.id} className={`rounded-md border p-2 text-sm space-y-1 ${v.status === "reversed" || v.status === "declined" ? "opacity-60" : ""}`}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">{categoryLabel(v.category)} · {formatNaira(v.amount_kobo)}</span>
              <span className="text-xs rounded border px-1.5 py-0.5">{STATUS_LABEL[v.status]}</span>
            </div>
            <div className={`text-muted-foreground ${v.status === "reversed" ? "line-through" : ""}`}>{v.note} · {v.recorded_by_name ?? "staff"} · {entryWhen(v.created_at)}</div>
            {(v.status === "reversed" || v.status === "declined") && <div className="text-xs text-muted-foreground">{v.status === "reversed" ? "Reversed" : "Declined"}{v.settledBy ? ` by ${v.settledBy}` : ""}{v.settledNote ? `: ${v.settledNote}` : ""}. It does not count.</div>}
            {(v.status === "paid" || v.status === "approved") && <ReceiptPhotos type="payout" recordId={v.id} businessId={businessId} role={role} />}
            {canReversePayout(role, v) && (reverseFor === v.id ? (
              <div className="space-y-2 rounded-md bg-muted p-2">
                <Label htmlFor={`rev-${v.id}`}>Reason (at least 5 characters)</Label>
                <Input id={`rev-${v.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={busy || !noteOk(reason)} onClick={async () => { if (await call("reverse_cash_payout", { p_payout_id: v.id, p_reason: reason.trim() }, "Reversed. The cash counts as back in the drawer.")) { setReverseFor(null); setReason(""); } }}>Reverse this payout</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setReverseFor(null); setReason(""); }}>Cancel</Button>
                </div>
              </div>
            ) : <Button size="sm" variant="outline" onClick={() => { setReverseFor(v.id); setReason(""); setMsg(null); }}>Reverse</Button>)}
          </li>
        ))}
      </ul>

      {owner && (
        <div className="space-y-2 border-t pt-3">
          <Label htmlFor="po-limit">Cashier limit for one shift (₦). Now {formatNaira(limit)}</Label>
          <div className="flex gap-2">
            <Input id="po-limit" type="number" min={0} value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="e.g. 10000" />
            <Button variant="outline" disabled={busy || limitInput === "" || nairaToKobo(limitInput) < 0} onClick={async () => { if (await call("set_drawer_payout_limit", { p_limit_kobo: nairaToKobo(limitInput) }, "The limit was changed.")) setLimitInput(""); }}>Save limit</Button>
          </div>
          <p className="text-xs text-muted-foreground">A cashier can take out up to this much in total on one shift. Anything above goes to you for approval.</p>
        </div>
      )}
    </section>
  );
}
