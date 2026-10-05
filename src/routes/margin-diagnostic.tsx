import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { weekRange, monthRange } from "@/lib/pnl";
import { loadMarginDiagnostic, round1, type MarginDiagnosticResult } from "@/lib/margin-diagnostic";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/margin-diagnostic")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Why did my margin change? — NairaPlate" },
      { name: "description", content: "The main reasons your profit margin moved: ingredient prices, what you sold, and wastage." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Why did my margin change? — NairaPlate" },
      { property: "og:description", content: "The main reasons your profit margin moved: ingredient prices, what you sold, and wastage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MarginDiagnosticScreen,
});

type Mode = "week" | "month";
const ROLES = new Set(["owner", "supa_admin"]);
const fmtPts = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(round1(p)).toFixed(1)} pts`;

function MarginDiagnosticScreen() {
  const { loading, session } = useStaffSession();
  const [mode, setMode] = useState<Mode>("week");
  const [res, setRes] = useState<MarginDiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (m: Mode) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const cur = m === "week" ? weekRange(0) : monthRange(0);
      const prev = m === "week" ? weekRange(1) : monthRange(1);
      setRes(await loadMarginDiagnostic(supabase, session.businessId, cur, prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not work out the reasons.");
    } finally { setBusy(false); }
  }, [session]);

  useEffect(() => { if (session && ROLES.has(session.role)) load(mode); }, [session, mode, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/app" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p className="text-muted-foreground">Only the owner or supa admin can see this.</p><Link to="/app" className="underline text-sm">← Home</Link></Shell>;

  const period = mode === "week" ? "week" : "month";
  return (
    <Shell>
      <Link to="/app" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Why did my margin change?</h1>
      <p className="mt-1 text-sm text-muted-foreground">This {period} so far compared with last {period}.</p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant={mode === "week" ? "default" : "outline"} onClick={() => setMode("week")}>This week vs last week</Button>
        <Button size="sm" variant={mode === "month" ? "default" : "outline"} onClick={() => setMode("month")}>This month vs last month</Button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {busy && <p className="mt-6 text-muted-foreground">Working it out…</p>}

      {res && !busy && (
        <div className="mt-6 space-y-4" data-testid="margin-diagnostic">
          <section className={`rounded-lg border p-4 ${res.direction === "down" ? "border-destructive/50" : "border-border"}`}>
            <p className="text-lg font-semibold text-foreground">{res.headline}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <Stat label={`Sales this ${period}`} value={formatNaira(res.sales_now_kobo)} />
              <Stat label="Profit after food cost" value={formatNaira(res.profit_now_kobo)} />
              <Stat label={`Last ${period}`} value={formatNaira(res.profit_before_kobo)} />
            </div>
          </section>

          {res.drivers.length === 0 && res.change_points !== null && (
            <p className="text-sm text-muted-foreground">No single big reason stood out. Small changes in prices, sales and wastage added up.</p>
          )}

          {res.drivers.map((d, i) => (
            <section key={d.key} className="rounded-lg border border-border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold text-foreground">{i + 1}. {d.title}</h2>
                <span className={`text-sm font-medium ${d.points < 0 ? "text-destructive" : "text-foreground"}`}>{fmtPts(d.points)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{d.summary}</p>
              {d.items.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {d.items.map((it) => (
                    <li key={it.label} className="flex justify-between gap-2">
                      <span className="text-foreground">{it.label}{it.detail && <span className="text-muted-foreground"> — {it.detail}</span>}</span>
                      <span className="shrink-0 text-muted-foreground">about {formatNaira(Math.round(Math.abs(it.amount_kobo)))}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to={d.link} className="mt-3 inline-block text-sm underline">{d.linkLabel} →</Link>
            </section>
          ))}

          {res.other_points !== null && res.drivers.length > 0 && Math.abs(res.other_points) >= 0.5 && (
            <p className="text-sm text-muted-foreground">
              Other changes (selling prices, recipe edits, rounding): about {fmtPts(res.other_points)}.
            </p>
          )}
          <div className="space-y-1 text-xs text-muted-foreground">{res.notes.map((n) => <p key={n}>{n}</p>)}</div>
        </div>
      )}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium text-foreground">{value}</p></div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
