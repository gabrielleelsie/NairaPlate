import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { loadCostCheck, loadStalePrices } from "@/lib/cost-check";
import { formatNaira } from "@/lib/costing";
import { useNews } from "@/components/NewsPanel";
import { TOPIC_LABEL } from "@/lib/news";

// A short morning card on the home screen. Owners get the cost check, purchasers just the old-price count.
export function CostCheckCard() {
  const { session } = useStaffSession();
  const [lines, setLines] = useState<string[] | null>(null);
  const role = session?.role;
  const news = useNews(role === "owner" || role === "supa_admin" || role === "purchaser");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const done = (l: string[]) => { if (!cancelled) setLines(l); };
    if (role === "owner" || role === "supa_admin") {
      loadCostCheck(supabase, session.businessId).then((c) => {
        const out: string[] = [];
        out.push(c.attention_total === 0 ? "All dishes are on target." : `${c.attention_total} dish${c.attention_total === 1 ? "" : "es"} under target margin.`);
        if (c.stale_total > 0) out.push(`${c.stale_total} ingredient price${c.stale_total === 1 ? "" : "s"} out of date.`);
        if (c.most_ordered) out.push(`Yesterday: most ordered ${c.most_ordered.name} (${c.most_ordered.plates}), most profitable ${c.most_profitable?.name ?? "—"}${c.most_profitable ? ` (${formatNaira(c.most_profitable.profit_kobo)})` : ""}.`);
        done(out);
      }).catch(() => done([]));
    } else if (role === "purchaser") {
      loadStalePrices(supabase, session.businessId).then((r) => done([r.total === 0 ? "All ingredient prices are up to date." : `${r.total} ingredient price${r.total === 1 ? "" : "s"} out of date.`])).catch(() => done([]));
    }
    return () => { cancelled = true; };
  }, [session, role]);

  const rising = news.on ? news.items?.filter((n) => n.rising) ?? [] : [];
  const newsLine = rising.length > 0 ? `In the news: ${rising.length} price rise headline${rising.length === 1 ? "" : "s"} (${[...new Set(rising.flatMap((n) => n.topics))].map((t) => TOPIC_LABEL[t] ?? t).join(", ")}).` : null;
  if (!lines || lines.length === 0) return null;
  return (
    <section aria-label="Today's cost check" className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold uppercase text-brand-navy/70">Today's cost check</h2>
      <ul className="mt-2 space-y-1 text-sm text-foreground">{[...lines, ...(newsLine ? [newsLine] : [])].map((l) => <li key={l}>{l}</li>)}</ul>
      <Link to="/cost-check" className="mt-3 inline-block text-sm font-semibold text-brand-blue underline underline-offset-4">See the details</Link>
    </section>
  );
}
