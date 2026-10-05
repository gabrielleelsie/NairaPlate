import { createFileRoute, Link } from "@tanstack/react-router";
import { FeatureGate } from "@/components/FeatureGate";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { dayRangeIso, payoutVariance } from "@/lib/payouts";
import { CORRECTION_COLUMNS, canReverse, friendlyReversalError, pairReversals, reasonOk, type Correctable, type WithReversal } from "@/lib/corrections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/payouts")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Channel payouts — NairaPlate" },
      { name: "description", content: "Check what delivery apps and channels actually paid you against what you sold." },
      { property: "og:title", content: "Channel payouts — NairaPlate" },
      { property: "og:description", content: "Check what delivery apps and channels actually paid you against what you sold." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FeatureGate feature="channel_payouts"><PayoutsScreen /></FeatureGate>,
});

const ROLES = new Set(["owner", "supa_admin"]);
const sel = "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Payout = Correctable & { id: string; channel: string; gross_sales_kobo: number; commission_kobo: number; net_payout_kobo: number; period_start: string | null; period_end: string | null; created_at: string };
const today = () => new Date().toLocaleDateString("en-CA");
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function PayoutsScreen() {
  const { loading, session } = useStaffSession();
  const [channels, setChannels] = useState<string[]>(["Walk-in", "Delivery"]);
  const [channel, setChannel] = useState("Walk-in");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toLocaleDateString("en-CA"); });
  const [to, setTo] = useState(today);
  const [gross, setGross] = useState<{ kobo: number; orders: number } | null>(null);
  const [commission, setCommission] = useState("");
  const [net, setNet] = useState("");
  const [history, setHistory] = useState<Payout[]>([]);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadBase() {
    const [o, h] = await Promise.all([
      supabase.from("orders").select("channel"),
      supabase.from("channel_payouts").select(`*,${CORRECTION_COLUMNS}`).order("created_at", { ascending: false }),
    ]);
    const used = new Set<string>(["Walk-in", "Delivery"]);
    (o.data ?? []).forEach((r) => r.channel && used.add(String(r.channel)));
    setChannels([...used]);
    setHistory((h.data ?? []).map((r) => ({ ...(r as Payout), gross_sales_kobo: Number(r.gross_sales_kobo), commission_kobo: Number(r.commission_kobo), net_payout_kobo: Number(r.net_payout_kobo) })));
  }

  // Step 1: gross sales = SUM(orders.total_kobo) for this channel, status 'paid', inside the dates.
  async function loadGross() {
    if (!from || !to || from > to) return setGross(null);
    const { startIso, endIso } = dayRangeIso(from, to);
    const { data, error } = await supabase.from("orders").select("total_kobo")
      .eq("channel", channel).eq("status", "paid").gte("created_at", startIso).lt("created_at", endIso);
    if (error) return setMsg({ ok: false, text: "Could not load sales: " + error.message });
    setGross({ kobo: (data ?? []).reduce((s, r) => s + Number(r.total_kobo), 0), orders: data?.length ?? 0 });
  }

  useEffect(() => { if (session && ROLES.has(session.role)) loadBase(); }, [session]);
  useEffect(() => { if (session && ROLES.has(session.role)) loadGross(); }, [session, channel, from, to]);

  const commissionKobo = commission === "" ? null : nairaToKobo(commission);
  const netKobo = net === "" ? null : nairaToKobo(net);
  const calc = gross && commissionKobo !== null && netKobo !== null ? payoutVariance(gross.kobo, commissionKobo, netKobo) : null;

  async function submit() {
    if (!session || !gross || !calc || commissionKobo === null || netKobo === null) return;
    setBusy(true); setMsg(null);
    // ONE database call: payout + mismatch alert saved together, or neither.
    // The database recalculates sales and the difference itself.
    const { data, error } = await supabase.rpc("log_channel_payout", {
      p_channel: channel, p_period_start: from, p_period_end: to,
      p_commission_kobo: commissionKobo, p_net_payout_kobo: netKobo, p_severity: calc.severity,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Nothing was saved: " + error.message });
    const r = data as { variance_kobo: number; flag_id: string | null };
    setMsg({ ok: true, text: `Payout saved. ${Number(r.variance_kobo) === 0 ? "It matches exactly." : `Difference: ${formatNaira(Number(r.variance_kobo))}. The mismatch has been added to Alerts.`}` });
    setCommission(""); setNet(""); loadBase();
  }

  async function reverse(p: Payout) {
    if (!reasonOk(reverseReason)) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("reverse_payout" as never, { p_payout_id: p.id, p_reason: reverseReason.trim() } as never);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: friendlyReversalError(error.message) });
    setReverseFor(null); setReverseReason("");
    setMsg({ ok: true, text: "Payout reversed. Record the correct payout above if you need to." });
    loadBase();
  }

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !ROLES.has(session.role))
    return <main className="p-6 space-y-2"><p>Owners only.</p><Link className="underline" to="/app">Home</Link></main>;

  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Channel payouts</h1><Link className="underline" to="/app">Home</Link></div>

      <section className="rounded-md border p-3 space-y-3">
        <div className="space-y-1"><Label htmlFor="po-ch">Channel</Label>
          <select id="po-ch" className={sel} value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1"><Label htmlFor="po-from">From</Label><Input id="po-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="flex-1 space-y-1"><Label htmlFor="po-to">To</Label><Input id="po-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="rounded-md bg-muted p-3" data-testid="gross">
          <div className="text-sm text-muted-foreground">Sales through {channel} in these dates</div>
          <div className="text-xl font-bold">{gross ? formatNaira(gross.kobo) : "—"}</div>
          {gross && <div className="text-xs text-muted-foreground">{gross.orders} paid order{gross.orders === 1 ? "" : "s"}</div>}
        </div>
      </section>

      <section className="rounded-md border p-3 space-y-3">
        <div className="space-y-1"><Label htmlFor="po-com">Commission they took (₦)</Label><Input id="po-com" type="number" min={0} value={commission} onChange={(e) => setCommission(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="po-net">Amount that reached your bank (₦)</Label><Input id="po-net" type="number" min={0} value={net} onChange={(e) => setNet(e.target.value)} /></div>
        {calc && (
          <div className="space-y-1 text-sm" data-testid="calc">
            <div className="flex justify-between"><span>You should have received</span><span>{formatNaira(calc.expected_net_kobo)}</span></div>
            <div className="flex justify-between"><span>You actually received</span><span>{formatNaira(netKobo!)}</span></div>
            <div className={`flex justify-between font-semibold ${calc.variance_kobo < 0 ? "text-destructive" : ""}`}>
              <span>Difference</span><span>{calc.variance_kobo === 0 ? "Matches" : formatNaira(calc.variance_kobo)}</span></div>
          </div>
        )}
        <Button className="w-full" onClick={submit} disabled={busy || !calc || !gross}>{busy ? "Saving…" : "Save payout"}</Button>
        {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Past payouts</h2>
        <ul className="space-y-2" data-testid="history">
          {pairReversals(history).length === 0 && <li className="text-muted-foreground">None yet.</li>}
          {pairReversals(history).map((p) => {
            const v = payoutVariance(p.gross_sales_kobo, p.commission_kobo, p.net_payout_kobo);
            return (
              <li key={p.id} className={`rounded-md border p-3 text-sm space-y-1 ${p.reversed ? "opacity-60" : ""}`}>
                <div className="flex justify-between font-medium"><span>{p.channel}{p.reversed && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">Reversed</span>}</span>
                  <span>{p.period_start && p.period_end ? `${fmtDay(p.period_start)} – ${fmtDay(p.period_end)}` : `saved ${new Date(p.created_at).toLocaleDateString("en-GB")}`}</span></div>
                <div className={`grid grid-cols-2 gap-x-3 text-muted-foreground ${p.reversed ? "line-through" : ""}`}>
                  <span>Sales: {formatNaira(p.gross_sales_kobo)}</span><span>Commission: {formatNaira(p.commission_kobo)}</span>
                  <span>Paid in: {formatNaira(p.net_payout_kobo)}</span>
                  <span className={v.variance_kobo !== 0 && !p.reversed ? "text-destructive font-semibold" : ""}>Difference: {v.variance_kobo === 0 ? "none" : formatNaira(v.variance_kobo)}</span>
                </div>
                {p.reversed && <p className="text-xs text-muted-foreground">Reversed{p.reversedBy ? ` by ${p.reversedBy}` : ""}{p.reversedAt ? ` on ${new Date(p.reversedAt).toLocaleDateString("en-GB")}` : ""}: {p.reversalReason}. It no longer counts.</p>}
                {canReverse(session.role, p) && (reverseFor === p.id ? (
                  <div className="space-y-2 rounded-md bg-muted p-2">
                    <Label htmlFor={`rev-${p.id}`}>Reason (at least 5 characters)</Label>
                    <Input id={`rev-${p.id}`} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busy || !reasonOk(reverseReason)} onClick={() => reverse(p)}>Reverse this payout</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : <Button size="sm" variant="outline" onClick={() => { setReverseFor(p.id); setReverseReason(""); setMsg(null); }}>Reverse</Button>)}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
