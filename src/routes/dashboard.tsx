import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { calculateBusinessPnl, type PnlResult } from "@/lib/pnl";
import { buildSlip, calculateEndOfDay, type EndOfDay } from "@/lib/end-of-day";
import { EndOfDaySlip } from "@/components/EndOfDaySlip";
import { lagosLastDays } from "@/lib/lagos-time";
import { formatNaira } from "@/lib/costing";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Profit & loss — NairaPlate" },
      { name: "description", content: "Sales, cost of food, and profit for your kitchen." },
      { property: "og:title", content: "Profit & loss — NairaPlate" },
      { property: "og:description", content: "Sales, cost of food, and profit for your kitchen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const OWNER_ROLES = new Set(["owner", "supa_admin"]);
const RANGES = [{ label: "Today", days: 1 }, { label: "7 days", days: 7 }, { label: "30 days", days: 30 }];

// "Today" is today in Nigeria time (WAT), ending at midnight Lagos.
const rangeFor = (days: number) => lagosLastDays(days);

function Dashboard() {
  const { loading, session } = useStaffSession();
  const [days, setDays] = useState(7);
  const [pnl, setPnl] = useState<PnlResult | null>(null);
  const [err, setErr] = useState("");
  // Cash in hand, transfers and the printable slip: only for the Today range.
  const [eod, setEod] = useState<EndOfDay | null>(null);
  const [eodErr, setEodErr] = useState("");
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    if (!session || !OWNER_ROLES.has(session.role)) return;
    setPnl(null); setErr("");
    calculateBusinessPnl(supabase, session.businessId, rangeFor(days)).then(setPnl).catch((e) => setErr(String(e.message ?? e)));
  }, [session, days]);

  useEffect(() => {
    setEod(null); setEodErr("");
    if (!session || !OWNER_ROLES.has(session.role) || days !== 1) return;
    calculateEndOfDay(supabase, session.businessId, rangeFor(1)).then(setEod).catch((e) => setEodErr(String(e.message ?? e)));
    supabase.from("businesses").select("name").eq("id", session.businessId).maybeSingle().then(({ data }) => setBusinessName(data?.name ?? ""));
  }, [session, days]);

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !OWNER_ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-5">
      {days === 1 && eod && <EndOfDaySlip slip={buildSlip(eod, businessName || "Your kitchen")} />}
      <div className={`space-y-5 ${days === 1 && eod ? "print:hidden" : ""}`}>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Profit & loss</h1>
        <div className="flex gap-3"><Link className="underline" to="/flags">Alerts</Link><Link className="underline" to="/app">Home</Link></div>
      </div>
      <div className="flex gap-2">
        {RANGES.map((r) => <Button key={r.days} variant={days === r.days ? "default" : "outline"} onClick={() => setDays(r.days)}>{r.label}</Button>)}
      </div>
      {days === 1 && (
        <Button variant="outline" disabled={!eod} onClick={() => window.print()}>Print end-of-day slip</Button>
      )}
      {days === 1 && eodErr && <p className="text-sm text-destructive">The cash and transfer figures could not be loaded: {eodErr}</p>}
      {err && <p className="text-destructive">Could not load: {err}</p>}
      {!pnl && !err && <p>Calculating…</p>}
      {pnl && (
        <>
          <section className="grid grid-cols-2 gap-3" aria-label="Summary">
            <Stat label="Money taken from sales" value={formatNaira(pnl.gross_sales_kobo)} note={`${pnl.paid_orders} paid orders`} />
            <Stat label="Cost of food used" value={formatNaira(pnl.cost_of_goods_kobo)}
              note={`${formatNaira(pnl.recipe_cost_of_goods_kobo)} in plates sold + ${formatNaira(pnl.wastage_cost_kobo)} wasted`} />
            <Stat label="Profit after food cost" value={formatNaira(pnl.gross_margin_kobo)} />
            <Stat label="Food cost as % of sales" value={pnl.food_cost_percentage === null ? "—" : `${pnl.food_cost_percentage.toFixed(1)}%`}
              note={pnl.food_cost_percentage === null ? "No sales yet" : `For every ₦100 taken, ₦${pnl.food_cost_percentage.toFixed(0)} went on food`} />
          </section>
          {days === 1 && eod && (
            <section className="grid grid-cols-2 gap-3" aria-label="Cash and transfers">
              <Stat label="Cash in hand" value={eod.cash.kobo === null ? "—" : formatNaira(eod.cash.kobo)} note={eod.cash.note} />
              <Stat label="Transfers confirmed today" value={formatNaira(eod.transfers.confirmed_kobo)} note={`${formatNaira(eod.transfers.waiting_kobo)} waiting to be confirmed`} />
              {!eod.sales.reconciles && <p className="col-span-2 text-sm text-destructive" role="alert">The cash, transfer and credit lines do not add up to total sales (difference {formatNaira(eod.sales.gap_kobo)}). Do not rely on the slip until this has been checked.</p>}
            </section>
          )}
          <section className="rounded-lg border p-3">
            <h2 className="font-semibold mb-2">Daily sales</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pnl.daily.map((d) => ({ date: d.date.slice(5), naira: d.sales_kobo / 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                  <Tooltip formatter={(v: number) => formatNaira(v * 100)} />
                  <Line type="monotone" dataKey="naira" stroke="var(--primary)" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          {pnl.warnings.map((w) => <p key={w} className="text-sm text-destructive">{w}</p>)}
          {pnl.limitations.map((l) => <p key={l} className="text-sm text-muted-foreground">Note: {l}</p>)}
        </>
      )}
      </div>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
