import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira } from "@/lib/costing";
import { loadCostCheck, loadStalePrices, STALE_DAYS, MARGIN_GAP_POINTS, type CostCheck, type DayStats, type StaleIngredient } from "@/lib/cost-check";

export const Route = createFileRoute("/cost-check")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Today's cost check — NairaPlate" },
      { name: "description", content: "Which dishes lost margin, which prices are old, and how yesterday compares." },
      { property: "og:title", content: "Today's cost check — NairaPlate" },
      { property: "og:description", content: "Which dishes lost margin, which prices are old, and how yesterday compares." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostCheckScreen,
});

const OWNER_ROLES = new Set(["owner", "supa_admin"]);

function change(now: number, before: number): string {
  if (before <= 0) return "—";
  const p = ((now - before) / before) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
}

function CostCheckScreen() {
  const { loading, session } = useStaffSession();
  const [data, setData] = useState<CostCheck | null>(null);
  const [stale, setStale] = useState<{ stale: StaleIngredient[]; total: number } | null>(null);
  const [err, setErr] = useState("");
  const isOwner = !!session && OWNER_ROLES.has(session.role);
  const isPurchaser = session?.role === "purchaser";

  useEffect(() => {
    if (!session) return;
    if (isOwner) loadCostCheck(supabase, session.businessId).then(setData).catch((e) => setErr(String(e.message ?? e)));
    else if (isPurchaser) loadStalePrices(supabase, session.businessId).then(setStale).catch((e) => setErr(String(e.message ?? e)));
  }, [session, isOwner, isPurchaser]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/app" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!isOwner && !isPurchaser) return <Shell><p>Owners and purchasers only.</p><Link className="underline" to="/app">Back</Link></Shell>;

  return (
    <Shell>
      <Link to="/app" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Today's cost check</h1>
      {err && <p className="mt-4 text-sm text-destructive">Could not load: {err}</p>}
      {!err && !data && !stale && <p className="mt-4 text-muted-foreground">Checking your costs…</p>}

      {isPurchaser && stale && <OldPrices items={stale.stale} total={stale.total} />}

      {isOwner && data && (
        <>
          <section className="mt-6">
            <h2 className="text-lg font-medium text-foreground">Needs attention</h2>
            {data.attention.length === 0 ? (
              <p className="mt-2 rounded-lg border border-border bg-card p-4 text-sm text-foreground">All dishes are on target.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {data.attention.map((d) => (
                  <li key={d.recipe_id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">{d.name}{d.grade ? ` (grade ${d.grade})` : ""}</span>
                      <span className="text-sm text-destructive">{d.margin_pct.toFixed(0)}% margin, target {d.target_pct.toFixed(0)}%</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Costs {formatNaira(d.cost_per_plate_kobo)} a plate, sells at {formatNaira(d.price_kobo)}.
                      {d.week_loss_kobo !== null && <> Roughly {formatNaira(d.week_loss_kobo)} a week below target (estimate from the last 7 days: {d.week_plates} plates).</>}
                    </p>
                    {d.suggested_price_kobo !== null && <p className="mt-1 text-sm text-foreground">Price for your target: {formatNaira(d.suggested_price_kobo)}.</p>}
                    {d.options.map((o) => (
                      <p key={o.grade} className="mt-1 text-sm text-foreground">At grade {o.grade}: {formatNaira(o.cost_per_plate_kobo)} a plate, {o.margin_pct.toFixed(0)}% margin.</p>
                    ))}
                    {d.fallbacks.length > 0 && <p className="mt-1 text-xs text-muted-foreground">No grade {d.grade} price yet for {d.fallbacks.join(", ")}, so the latest price is used.</p>}
                    <Link to="/recipes" search={{ edit: d.recipe_id } as never} className="mt-2 inline-block text-sm underline text-foreground">Open this dish</Link>
                  </li>
                ))}
              </ul>
            )}
            {data.attention_total > data.attention.length && <p className="mt-2 text-xs text-muted-foreground">{data.attention_total - data.attention.length} more under target. Fix these first, the biggest losses are at the top.</p>}
            <p className="mt-2 text-xs text-muted-foreground">A dish shows here when its margin is {MARGIN_GAP_POINTS} points or more under your target.</p>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-medium text-foreground">Yesterday</h2>
            {data.yesterday.orders === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No sales were recorded on {data.yesterday.label}.</p>
            ) : (
              <>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="text-xs uppercase text-muted-foreground">Most ordered</div>
                    <div className="mt-1 font-medium text-foreground">{data.most_ordered?.name ?? "—"}</div>
                    <div className="text-sm text-muted-foreground">{data.most_ordered ? `${data.most_ordered.plates} plates` : ""}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="text-xs uppercase text-muted-foreground">Most profitable</div>
                    <div className="mt-1 font-medium text-foreground">{data.most_profitable?.name ?? "—"}</div>
                    <div className="text-sm text-muted-foreground">{data.most_profitable ? `${formatNaira(data.most_profitable.profit_kobo)} profit` : ""}</div>
                  </div>
                </div>
                <Compare a={data.yesterday} b={data.last_month} />
              </>
            )}
            {data.estimated_lines > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {data.estimated_lines} sold item{data.estimated_lines === 1 ? "" : "s"} were recorded before costs were saved with each sale, so {data.estimated_lines === 1 ? "its" : "their"} cost uses today's ingredient prices.
              </p>
            )}
            {data.uncosted_lines > 0 && <p className="mt-1 text-xs text-destructive">{data.uncosted_lines} sold item{data.uncosted_lines === 1 ? "" : "s"} could not be costed (a missing unit conversion), so profit is overstated.</p>}
          </section>

          <OldPrices items={data.stale} total={data.stale_total} />

          {data.scarce.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-medium text-foreground">Scarce right now</h2>
              <p className="mt-1 text-sm text-muted-foreground">Marked Scarce on your last purchase:</p>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
                {data.scarce.map((s) => <li key={s.name} className="flex justify-between p-3 text-sm"><span className="text-foreground">{s.name}</span><span className="text-muted-foreground">used in {s.dishes} dish{s.dishes === 1 ? "" : "es"}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

function Compare({ a, b }: { a: DayStats; b: DayStats }) {
  const rows: [string, number, number, boolean][] = [
    ["Sales", a.sales_kobo, b.sales_kobo, true], ["Profit", a.profit_kobo, b.profit_kobo, true],
    ["Orders", a.orders, b.orders, false], ["Plates", a.plates, b.plates, false],
  ];
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-medium text-foreground">Like for like with the same date last month</div>
      {b.orders === 0 && <p className="mt-1 text-xs text-muted-foreground">No sales were recorded on {b.label}, so there is nothing to compare with.</p>}
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="font-normal"> </th><th className="text-right font-normal">{a.label}</th><th className="text-right font-normal">{b.label}</th><th className="text-right font-normal">Change</th></tr></thead>
        <tbody>
          {rows.map(([label, x, y, money]) => (
            <tr key={label} className="border-t border-border">
              <td className="py-2 text-muted-foreground">{label}</td>
              <td className="py-2 text-right text-foreground">{money ? formatNaira(x) : x}</td>
              <td className="py-2 text-right text-foreground">{money ? formatNaira(y) : y}</td>
              <td className="py-2 text-right text-foreground">{change(x, y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Compared by calendar date, so the two days may fall on different weekdays. Part-refunds are not taken off the dish figures.</p>
    </div>
  );
}

function OldPrices({ items, total }: { items: StaleIngredient[]; total: number }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium text-foreground">Old prices</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Every ingredient price in your dishes was updated in the last {STALE_DAYS} days.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Not bought for {STALE_DAYS} days or more, so the dish costs using them may be wrong:</p>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((s) => <li key={s.id} className="flex justify-between p-3 text-sm"><span className="text-foreground">{s.name}</span><span className="text-muted-foreground">{s.days_old === null ? "never bought" : `${s.days_old} days old`}</span></li>)}
          </ul>
          {total > items.length && <p className="mt-1 text-xs text-muted-foreground">{total - items.length} more.</p>}
          <Link to="/purchases" className="mt-2 inline-block text-sm underline text-foreground">Log a purchase</Link>
        </>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
