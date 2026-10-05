import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABEL, loadInboxItems, summarise, type InboxCategory, type InboxItem } from "@/lib/inbox";
import { lagosDayStart, DAY_MS } from "@/lib/lagos-time";

export const Route = createFileRoute("/inbox")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Attention inbox — NairaPlate" },
      { name: "description", content: "Everything that needs the owner's attention today, in one place." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Attention inbox — NairaPlate" },
      { property: "og:description", content: "Everything that needs the owner's attention today, in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Inbox,
});

const CATS: InboxCategory[] = ["approval", "cash", "stock", "system"];
type Range = "today" | "week" | "all";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DOT = { high: "bg-destructive", medium: "bg-brand-blue", low: "bg-muted-foreground" };

function Inbox() {
  const { loading, session } = useStaffSession();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [only, setOnly] = useState<InboxCategory | null>(null);
  const isOwner = session?.role === "owner" || session?.role === "supa_admin";

  const load = useCallback(async () => {
    if (!session || !isOwner) return;
    try { const r = await loadInboxItems(supabase, session.businessId); setItems(r.items); setWarnings(r.warnings); }
    catch (e) { setErr((e as Error).message); }
  }, [session, isOwner]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    if (!items) return [];
    const now = new Date();
    const from = range === "today" ? lagosDayStart(now).getTime() : range === "week" ? lagosDayStart(now).getTime() - 6 * DAY_MS : 0;
    // Approvals and undated (live) items always stay visible until handled at their source.
    return items.filter((i) => i.category === "approval" || !i.at || Date.parse(i.at) >= from);
  }, [items, range]);
  const summary = summarise(shown);

  async function seen(id: string) {
    const { error } = await supabase.from("margin_flags").update({ acknowledged: true }).eq("id", id);
    if (error) return setErr(error.message);
    load();
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !isOwner) return <main className="space-y-3 p-6"><p>Only the owner can see the attention inbox.</p><Link className="underline" to="/app">Back</Link></main>;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">What needs my attention?</h1>
        <Link className="underline" to="/app">Home</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATS.map((c) => (
          <button key={c} type="button" aria-pressed={only === c} onClick={() => setOnly(only === c ? null : c)}
            className={`rounded-lg border p-3 text-left ${only === c ? "border-brand-blue bg-accent" : "bg-card"}`}>
            <div className="text-2xl font-semibold">{summary[c]}</div>
            <div className="text-xs uppercase text-muted-foreground">{CATEGORY_LABEL[c]}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-2" role="group" aria-label="Date range">
        {([["today", "Today"], ["week", "Past 7 days"], ["all", "All active"]] as const).map(([k, l]) => (
          <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)}>{l}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Items clear when they are handled on their own screen. Waiting approvals always show.</p>
      {err && <p className="text-destructive">{err}</p>}
      {warnings.length > 0 && <p className="text-sm text-destructive">Could not load: {warnings.join(", ")}. The list may be incomplete.</p>}
      {!items && !err && <p>Loading…</p>}
      {items && shown.length === 0 && <p>Nothing needs your attention.</p>}
      {CATS.filter((c) => !only || only === c).map((c) => {
        const list = shown.filter((i) => i.category === c);
        if (!list.length) return null;
        return (
          <section key={c} aria-labelledby={`inbox-${c}`} className="space-y-2">
            <h2 id={`inbox-${c}`} className="text-sm font-semibold uppercase text-muted-foreground">{CATEGORY_LABEL[c]} ({list.length})</h2>
            {list.map((i) => (
              <div key={i.key} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="flex min-w-0 gap-2">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${DOT[i.severity]}`} aria-label={`${i.severity} priority`} />
                  <div className="min-w-0">
                    <p className="font-medium">{i.title}</p>
                    {i.detail && <p className="text-sm text-muted-foreground">{i.detail}</p>}
                    {i.at && <p className="text-xs text-muted-foreground">{fmt(i.at)}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {i.flagId && <Button size="sm" variant="outline" onClick={() => seen(i.flagId!)}>Mark as seen</Button>}
                  <Button size="sm" asChild><Link to={i.link}>{i.linkLabel}</Link></Button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}
