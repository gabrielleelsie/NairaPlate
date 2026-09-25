import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/orders")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Orders, voids & refunds — NairaPlate" },
      { name: "description", content: "See past till orders, void or refund them, and review every adjustment." },
      { property: "og:title", content: "Orders, voids & refunds — NairaPlate" },
      { property: "og:description", content: "See past till orders, void or refund them, and review every adjustment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersScreen,
});

const ROLES = new Set(["cashier", "owner", "supa_admin"]);
type Adj = { id: string; order_id: string; type: string; original_amount_kobo: number; adjustment_amount_kobo: number; reason: string; actor_id: string; created_at: string };
type Order = { id: string; total_kobo: number; status: string; payment_method: string; channel: string | null; created_by: string | null; created_at: string; order_adjustments: Adj[] };
type Kind = "void" | "full_refund" | "partial_refund";
const TYPE_LABEL: Record<string, string> = { void: "Void", full_refund: "Full refund", partial_refund: "Part refund" };
const STATUS_LABEL: Record<string, string> = { paid: "Paid", cancelled: "Voided", refunded: "Refunded", partially_refunded: "Part refunded", draft: "Draft" };

const ref = (id: string) => `#${id.slice(0, 8)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const lagosDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const refundedOf = (o: Order) => o.order_adjustments.filter((a) => a.type === "partial_refund").reduce((s, a) => s + Number(a.adjustment_amount_kobo), 0);

function OrdersScreen() {
  const { session, loading } = useStaffSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [adjs, setAdjs] = useState<Adj[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    const [o, a, s] = await Promise.all([
      supabase.from("orders").select("id,total_kobo,status,payment_method,channel,created_by,created_at,order_adjustments(*)")
        .eq("business_id", session.businessId).order("created_at", { ascending: false }).limit(100),
      supabase.from("order_adjustments").select("*").eq("business_id", session.businessId).order("created_at", { ascending: false }),
      supabase.from("staff_users").select("id,display_name").eq("business_id", session.businessId),
    ]);
    if (o.error) setErr(o.error.message);
    setOrders((o.data ?? []) as Order[]);
    setAdjs((a.data ?? []) as Adj[]);
    // staff_users is owner-only under the access rules; cashiers see "Me" / "Staff".
    setNames(Object.fromEntries((s.data ?? []).map((r) => [r.id, r.display_name])));
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6">Only cashiers and owners can see orders. <Link to="/" className="underline">Home</Link></main>;
  const who = (id: string | null) => (id && names[id]) || (id === session.userId ? `${session.name} (me)` : "Other staff");

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders</h1>
        <Link to="/" className="text-sm underline">Home</Link>
      </div>
      {err && <p className="text-destructive">{err}</p>}
      <Tabs defaultValue="orders">
        <TabsList><TabsTrigger value="orders">Orders</TabsTrigger><TabsTrigger value="adjustments">Adjustments</TabsTrigger></TabsList>
        <TabsContent value="orders" className="space-y-2">
          {orders.length === 0 && <p className="text-muted-foreground">No orders yet.</p>}
          {orders.map((o) => {
            const refunded = refundedOf(o);
            const canAdjust = o.status === "paid" || o.status === "partially_refunded";
            return (
              <div key={o.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{ref(o.id)} · {formatNaira(Number(o.total_kobo))}
                      {refunded > 0 && <span className="text-muted-foreground"> (−{formatNaira(refunded)} refunded)</span>}
                    </div>
                    <div className="text-sm text-muted-foreground">{when(o.created_at)} · {o.payment_method} · {o.channel ?? "Walk-in"} · by {who(o.created_by)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[o.status] ?? o.status}</span>
                    {canAdjust && <Button size="sm" variant="outline" onClick={() => setOpenId(openId === o.id ? null : o.id)}>Void / Refund</Button>}
                  </div>
                </div>
                {openId === o.id && (
                  <AdjustForm order={o} refunded={refunded} isCashier={session.role === "cashier"} myId={session.userId}
                    onDone={() => { setOpenId(null); void load(); }} />
                )}
              </div>
            );
          })}
        </TabsContent>
        <TabsContent value="adjustments" className="space-y-2">
          {adjs.length === 0 && <p className="text-muted-foreground">No voids or refunds yet.</p>}
          {adjs.map((a) => (
            <div key={a.id} className="rounded-md border p-3 text-sm">
              <div className="font-medium">{TYPE_LABEL[a.type] ?? a.type} · {formatNaira(Number(a.adjustment_amount_kobo))} on order {ref(a.order_id)} ({formatNaira(Number(a.original_amount_kobo))})</div>
              <div className="text-muted-foreground">"{a.reason}" · {who(a.actor_id)} · {when(a.created_at)}</div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function AdjustForm({ order, refunded, isCashier, myId, onDone }: { order: Order; refunded: number; isCashier: boolean; myId: string; onDone: () => void }) {
  const sameDay = lagosDay(new Date(order.created_at)) === lagosDay(new Date());
  const [kind, setKind] = useState<Kind>(sameDay && order.status === "paid" ? "void" : "full_refund");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const left = Number(order.total_kobo) - refunded;
  const amountK = nairaToKobo(amount);

  // Cashiers can only adjust orders they created. Checked here AND in the database function.
  if (isCashier && order.created_by !== myId) {
    return <p className="mt-3 font-medium text-destructive">Only an owner can adjust another cashier's order</p>;
  }

  const voidOk = sameDay && order.status === "paid";
  const reasonOk = reason.trim().length >= 5;
  const amountOk = kind !== "partial_refund" || (amountK > 0 && amountK < left);

  async function submit() {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("adjust_order", {
      p_order_id: order.id, p_type: kind, p_reason: reason.trim(),
      p_amount_kobo: kind === "partial_refund" ? amountK : null,
    });
    setBusy(false);
    if (error) setMsg(error.message); else onDone();
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="flex flex-wrap gap-3 text-sm">
        {(["void", "full_refund", "partial_refund"] as Kind[]).map((k) => (
          <label key={k} className={`flex items-center gap-1 ${k === "void" && !voidOk ? "opacity-50" : ""}`}>
            <input type="radio" name={`k-${order.id}`} checked={kind === k} disabled={k === "void" && !voidOk} onChange={() => setKind(k)} />
            {TYPE_LABEL[k]}
          </label>
        ))}
      </div>
      {!voidOk && <p className="text-xs text-muted-foreground">Void is only for today's unrefunded sales. Use a refund instead.</p>}
      {kind === "partial_refund" && (
        <div className="space-y-1">
          <Label htmlFor={`amt-${order.id}`}>Amount to refund (₦) — less than {formatNaira(left)}</Label>
          <Input id={`amt-${order.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`r-${order.id}`}>Reason (at least 5 letters)</Label>
        <Textarea id={`r-${order.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
      <Button disabled={busy || !reasonOk || !amountOk} onClick={submit}>
        {kind === "void" ? `Void ${formatNaira(Number(order.total_kobo))}` : kind === "full_refund" ? `Refund ${formatNaira(left)}` : `Refund ${formatNaira(amountOk ? amountK : 0)}`}
      </Button>
    </div>
  );
}
