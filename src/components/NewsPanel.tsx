import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/external-supabase";
import { SHOW_DAYS, TOPIC_LABEL, agoLabel, type TopicKey } from "@/lib/news";

type Item = { id: string; url: string; title: string; source: string; published_at: string; topics: TopicKey[]; rising: boolean };

/** Headlines about fuel, transport, rice, pepper, tomatoes and onions prices. News only: it never changes a cost or a price. */
export function useNews(enabledForRole: boolean) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    if (!enabledForRole) return;
    const since = new Date(Date.now() - SHOW_DAYS * 86_400_000).toISOString();
    const [prefs, news] = await Promise.all([
      supabase.from("business_news_prefs").select("enabled").maybeSingle(),
      supabase.from("news_items").select("id,url,title,source,published_at,topics,rising").gte("published_at", since).order("published_at", { ascending: false }).limit(12),
    ]);
    setOn(prefs.error ? true : prefs.data ? !!prefs.data.enabled : true); // no row = on
    setItems(news.error ? [] : ((news.data ?? []) as Item[]));
  }, [enabledForRole]);
  useEffect(() => { load(); }, [load]);
  return { items, on, reload: load };
}

export function NewsPanel({ canSwitch, items, on, reload }: { canSwitch: boolean; items: Item[] | null; on: boolean | null; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function set(enabled: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("set_news_enabled" as never, { p_enabled: enabled } as never);
    setBusy(false);
    if (error) return setErr(error.message);
    reload();
  }
  if (on === null || items === null) return null;

  return (
    <section className="mt-8" data-testid="news-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">In the news</h2>
        {canSwitch && on && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => set(false)}>Turn off news</Button>}
      </div>
      {!on ? (
        <p className="mt-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          News headlines are turned off for your business.{" "}
          {canSwitch ? <button type="button" className="underline text-foreground" disabled={busy} onClick={() => set(true)}>Turn them on</button> : "Ask your owner if you want them back."}
        </p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No price headlines about fuel, transport, rice, pepper, tomatoes or onions in the last {SHOW_DAYS} days.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Headlines from Nigerian news sites about fuel, transport, rice, pepper, tomatoes and onions. They are news, not confirmed prices, and they change nothing in your costs.</p>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((n) => (
              <li key={n.id} className="p-3 text-sm">
                <a href={n.url} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline underline-offset-2">{n.title}</a>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {n.source} · {agoLabel(n.published_at)} · {n.topics.map((t) => TOPIC_LABEL[t] ?? t).join(", ")}{n.rising ? " · price rising" : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}
