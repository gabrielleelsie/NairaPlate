import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { formatNaira } from "@/lib/costing";
import { waitState, type RequestRow } from "@/lib/payment-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type WaitingRequest = RequestRow & { id: string; order_id: string; reference: string; account_number: string | null; bank_name: string | null; account_name: string | null };

/** One order waiting for the bank. Checks every few seconds; the order turns Paid by itself when the money arrives. No button here can mark it paid. */
export function TransferWaiting({ initial, onFinished }: { initial: WaitingRequest; onFinished: (text: string, ok: boolean) => void }) {
  const [r, setR] = useState<WaitingRequest>(initial);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const { data } = await supabase.from("payment_requests").select("id,order_id,reference,status,amount_kobo,paid_amount_kobo,created_at,account_number,bank_name,account_name").eq("id", initial.id).maybeSingle();
      if (stop || !data) return;
      setNow(new Date());
      setR({ ...(data as WaitingRequest), amount_kobo: Number(data.amount_kobo), paid_amount_kobo: data.paid_amount_kobo === null ? null : Number(data.paid_amount_kobo) });
    };
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [initial.id]);

  const w = waitState(r, now);
  useEffect(() => { if (w.kind === "paid") onFinished(`Payment received: ${formatNaira(Number(r.amount_kobo))}. Order paid.`, true); }, [w.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel() {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("cancel_unpaid_order" as never, { p_order_id: r.order_id, p_reason: reason } as never);
    setBusy(false);
    if (error) return setErr(error.message);
    onFinished("Order cancelled. The stock has been put back.", true);
  }

  if (w.kind === "paid" || w.kind === "cancelled") return null;
  return (
    <section className="space-y-2 rounded-lg border border-primary p-3" data-testid="transfer-waiting">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Waiting for payment</h2>
        <span className="text-lg font-semibold">{formatNaira(Number(r.amount_kobo))}</span>
      </div>
      {r.account_number ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Customer pays exactly this amount to:</p>
          <p className="text-2xl font-bold tracking-wide" data-testid="account-number">{r.account_number}</p>
          <p className="text-sm">{[r.bank_name, r.account_name].filter(Boolean).join(" · ")}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Getting the account number…</p>
      )}
      {w.kind === "short" && <p className="text-sm font-medium text-destructive">Part payment received. {formatNaira(w.short_by_kobo)} still to pay.</p>}
      {w.kind === "long_wait" && <p className="text-sm text-muted-foreground">Still waiting. If the customer has left, cancel the order. It turns Paid on its own when the money arrives.</p>}
      {w.kind === "waiting" && <p className="text-sm text-muted-foreground">This turns Paid by itself when the money arrives. Nobody can mark it paid by hand.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!cancelling ? (
        <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>Cancel this order</Button>
      ) : (
        <div className="flex gap-2">
          <Input aria-label="Reason for cancelling" placeholder="Why is it being cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={cancel}>{busy ? "…" : "Cancel order"}</Button>
          <Button size="sm" variant="outline" onClick={() => setCancelling(false)}>Keep</Button>
        </div>
      )}
    </section>
  );
}
