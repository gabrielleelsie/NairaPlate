import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import {
  compareBusinessPnl, weekRange, monthRange,
  type PnlResult, type PeriodComparison,
} from "@/lib/pnl";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/report")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Printable report — NairaPlate" },
      { name: "description", content: "This week vs last week, this month vs last month: sales, food cost and profit — ready to print." },
      { property: "og:title", content: "Printable report — NairaPlate" },
      { property: "og:description", content: "This week vs last week, this month vs last month: sales, food cost and profit — ready to print." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportScreen,
});

type Mode = "week" | "month";

const ROLES = new Set(["owner", "supa_admin"]);

function ReportScreen() {
  const { loading, session } = useStaffSession();
  const [mode, setMode] = useState<Mode>("week");
  const [cmp, setCmp] = useState<PeriodComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (m: Mode) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const cur = m === "week" ? weekRange(0) : monthRange(0);
      const prev = m === "week" ? weekRange(1) : monthRange(1);
      const result = await compareBusinessPnl(supabase, session.businessId, cur, prev);
      setCmp(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the report.");
    } finally {
      setBusy(false);
    }
  }, [session]);

  useEffect(() => { if (session && ROLES.has(session.role)) load(mode); }, [session, mode, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p className="text-muted-foreground">Only the owner or supa admin can see reports.</p><Link to="/" className="underline text-sm">← Home</Link></Shell>;

  const periodLabel = mode === "week" ? "week" : "month";
  const cur = cmp?.current;
  const prev = cmp?.previous;

  return (
    <Shell>
      <div className="flex items-center justify-between print:block">
        <Link to="/" className="text-sm text-muted-foreground underline print:hidden">← Home</Link>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>Print</Button>
      </div>
      <h1 className="mt-4 text-3xl font-semibold text-foreground print:mt-0">
        {mode === "week" ? "Weekly report" : "Monthly report"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This {periodLabel} compared with last {periodLabel}.
      </p>

      <div className="mt-4 flex gap-2 print:hidden">
        <Button variant={mode === "week" ? "default" : "outline"} size="sm" onClick={() => setMode("week")}>Week</Button>
        <Button variant={mode === "month" ? "default" : "outline"} size="sm" onClick={() => setMode("month")}>Month</Button>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {busy && <p className="mt-6 text-muted-foreground">Working it out…</p>}

      {cur && prev && !busy && (
        <>
          <table className="mt-6 w-full border-collapse text-sm" data-testid="report-table">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-2 font-medium text-muted-foreground">This {periodLabel}</th>
                <th className="py-2 pr-2 text-right font-medium text-foreground">{dateLabel(mode === "week" ? weekRange(0) : monthRange(0))}</th>
                <th className="py-2 pr-2 text-right font-medium text-foreground">{dateLabel(mode === "week" ? weekRange(1) : monthRange(1))}</th>
                <th className="py-2 text-right font-medium text-muted-foreground">Change</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Money taken from sales" cur={cur.gross_sales_kobo} prev={prev.gross_sales_kobo} money />
              <CompareRow label="Cost of food used" cur={cur.cost_of_goods_kobo} prev={prev.cost_of_goods_kobo} money inverse />
              <CompareRow label="Profit after food cost" cur={cur.gross_margin_kobo} prev={prev.gross_margin_kobo} money strong />
              <CompareRow
                label="Food cost as % of sales"
                cur={cur.food_cost_percentage} prev={prev.food_cost_percentage}
                format={(v) => v === null ? "—" : `${Math.round(v)}%`}
              />
              <CompareRow label="Paid orders" cur={cur.paid_orders} prev={prev.paid_orders} format={(v) => String(v)} />
            </tbody>
          </table>

          {cur.warnings.length > 0 && (
            <div className="mt-4 rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {cur.warnings.map((w) => <p key={w}>{w}</p>)}
            </div>
          )}
          <div className="mt-4 text-xs text-muted-foreground">
            {cur.limitations.map((l) => <p key={l}>{l}</p>)}
          </div>
        </>
      )}
    </Shell>
  );
}

function CompareRow({ label, cur, prev, money, inverse, strong, format }: {
  label: string;
  cur: number | null; prev: number | null;
  money?: boolean; inverse?: boolean; strong?: boolean;
  format?: (v: number | null) => string;
}) {
  const fmt = format ?? (money ? (v) => formatNaira(v) : (v) => String(v));
  let change: string | null = null;
  let bad = false;
  if (cur !== null && prev !== null) {
    const d = cur - prev;
    if (d !== 0) {
      change = (d > 0 ? "+" : "") + fmt(d).replace("₦", "₦");
      // inverse: an increase is bad (e.g. cost of food). For % rows, an increase is bad too.
      bad = inverse ? d > 0 : d < 0;
    }
  }
  return (
    <tr className="border-b border-border/60" data-testid="report-row">
      <td className={`py-2 pr-2 ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</td>
      <td className={`py-2 pr-2 text-right ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>{fmt(cur)}</td>
      <td className="py-2 pr-2 text-right text-muted-foreground">{fmt(prev)}</td>
      <td className={`py-2 text-right ${change === null ? "text-muted-foreground" : bad ? "text-destructive" : "text-foreground"}`}>
        {change ?? "—"}
      </td>
    </tr>
  );
}

function dateLabel(r: { from: Date; to: Date }) {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  const f = r.from.toLocaleDateString("en-GB", opts);
  const t = new Date(r.to);
  t.setUTCDate(t.getUTCDate() - 1);
  return `${f} – ${t.toLocaleDateString("en-GB", opts)}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12 print:p-0"><div className="mx-auto max-w-2xl">{children}</div></main>;
}

// keep PnlResult referenced for typing clarity
export type { PnlResult };
