import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { calculateBusinessPnl, type PnlResult } from "@/lib/pnl";
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

function rangeFor(days: number) {
  const to = new Date(); to.setUTCHours(24, 0, 0, 0); // end of today
  const from = new Date(to); from.setUTCDate(from.getUTCDate() - days);
  return { from, to };
}

function Dashboard() {
  const { loading, session } = useStaffSession();
  const [days, setDays] = useState(7);
  const [pnl, setPnl] = useState<PnlResult | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!session || !OWNER_ROLES.has(session.role)) return;
    setPnl(null); setErr("");
    calculateBusinessPnl(supabase, session.businessId, rangeFor(days)).then(setPnl).catch((e) => setErr(String(e.message ?? e)));
  }, [session, days]);

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !OWNER_ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Owners only.</p><Link className="underline" to="/">Back</Link></main>;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-5">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Profit & loss</h1>
        <div className="flex gap-3"><Link className="underline" to="/flags">Alerts</Link><Link className="underline" to="/">Home</Link></div>
      </div>
      <div className="flex gap-2">
        {RANGES.map((r) => <Button key={r.days} variant={days === r.days ? "default" : "outline"} onClick={() => setDays(r.days)}>{r.label}</Button>)}
      </div>
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
