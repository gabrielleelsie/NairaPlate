import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { calculateCashflowForecast, type CashflowForecast } from "@/lib/cashflow";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cashflow")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "7-day cashflow — NairaPlate" },
      { name: "description", content: "Cash in hand, money coming in and money going out over the next 7 days." },
      { property: "og:title", content: "7-day cashflow — NairaPlate" },
      { property: "og:description", content: "Where your cash will stand over the next 7 days." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CashflowScreen,
});

const ROLES = new Set(["owner", "supa_admin"]);
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function CashflowScreen() {
  const { loading, session } = useStaffSession();
  const [f, setF] = useState<CashflowForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setErr(null);
    try { setF(await calculateCashflowForecast(supabase, session.businessId)); }
    catch { setErr("Could not work out the forecast."); }
  }, [session]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p className="text-muted-foreground">Only owners can see the cashflow forecast.</p><Link to="/" className="underline text-sm">Home</Link></Shell>;

  return (
    <Shell>
      <Link to="/" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Next 7 days: cashflow</h1>
      {f && <p className="mt-1 text-sm text-muted-foreground">{day(f.window.from)} – {day(f.window.to)}</p>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      {f && (
        <>
          <Part title="Cash you should have in the drawers now" amount={f.cash_on_hand_kobo} sign="+">
            {f.open_drawers.length === 0
              ? "No shift is open, so no drawer cash is counted."
              : f.open_drawers.map((d) => (
                  <div key={d.id}>Shift opened {new Date(d.opened_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}: float {formatNaira(d.opening_float_kobo)} + cash sales {formatNaira(d.cash_sales_kobo)}</div>
                ))}
          </Part>

          <Part title="Money customers owe you" amount={f.owed_to_us_kobo} sign="+">
            <div>Customer credit not yet paid: {formatNaira(f.customer_credit_kobo)} ({f.customer_credit_count} {f.customer_credit_count === 1 ? "person" : "people"})</div>
            <div>Catering balances for events in the next 7 days: {formatNaira(f.catering_due_kobo)}</div>
            {f.catering_due.map((b) => <div key={b.id} className="pl-3">· {b.customer_name}, {day(b.event_date)}: {formatNaira(b.remaining_kobo)}</div>)}
          </Part>

          <Part title="Money you owe suppliers" amount={f.owed_out_kobo} sign="−">
            {f.suppliers_owed.length === 0 ? "You don't owe any supplier." :
              f.suppliers_owed.map((s) => <div key={s.id}>{s.name}: {formatNaira(s.balance_kobo)}</div>)}
          </Part>

          <div className="mt-6 rounded-lg border-2 border-foreground p-5">
            <div className="text-sm text-muted-foreground">Where you'll stand if everyone pays and you pay everyone</div>
            <div className={`mt-1 text-4xl font-semibold ${f.projected_kobo < 0 ? "text-destructive" : "text-foreground"}`}>{formatNaira(f.projected_kobo)}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {formatNaira(f.cash_on_hand_kobo)} in drawers + {formatNaira(f.owed_to_us_kobo)} owed to you − {formatNaira(f.owed_out_kobo)} you owe
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Only counts drawer cash — not money in the bank. Customer credit has no due date, so all of it is counted.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>Refresh</Button>
        </>
      )}
    </Shell>
  );
}

function Part({ title, amount, sign, children }: { title: string; amount: number; sign: "+" | "−"; children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-lg border border-border p-4">
      <div className="flex justify-between gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="font-semibold text-foreground">{sign} {formatNaira(amount)}</span>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl bg-background p-6">{children}</main>;
}
