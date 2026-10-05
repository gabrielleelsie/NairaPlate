import { createFileRoute, Link } from "@tanstack/react-router";
import { FeatureGate } from "@/components/FeatureGate";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, marketUnitLabel } from "@/lib/staff-session";
import { formatNaira, unitsForIngredient, type CostConversion, type CostIngredient } from "@/lib/costing";
import { countedToBase, summarizeLosses, variance, type Movement } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/stock-take")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Stock take — NairaPlate" },
      { name: "description", content: "Count what is on the shelf, see what is missing, and find where stock is leaking." },
      { property: "og:title", content: "Stock take — NairaPlate" },
      { property: "og:description", content: "Count what is on the shelf, see what is missing, and find where stock is leaking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FeatureGate feature="stock_take"><StockTake /></FeatureGate>,
});

const ROLES = new Set(["owner", "supa_admin", "purchaser", "cook"]);
const OWNERS = new Set(["owner", "supa_admin"]);
type Ing = CostIngredient & { stock_base_qty: number };
type Count = { id: string; is_opening: boolean; status: string; note: string | null; counted_by_name: string | null; decided_by_name: string | null; total_variance_kobo: number; created_at: string };
type Line = { count_id: string; ingredient_id: string; expected_base: number; counted_base: number; variance_base: number; value_kobo: number; note: string | null };
const fmtQty = (n: number) => String(Number(Number(n).toFixed(3)));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

function StockTake() {
  const { loading, session } = useStaffSession();
  const [ings, setIngs] = useState<Ing[]>([]);
  const [convs, setConvs] = useState<CostConversion[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isOwner = !!session && OWNERS.has(session.role);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [i, c, k, l, m] = await Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo,stock_base_qty").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
      supabase.from("stock_counts").select("id,is_opening,status,note,counted_by_name,decided_by_name,total_variance_kobo,created_at").order("created_at", { ascending: false }).limit(15),
      supabase.from("stock_count_lines").select("count_id,ingredient_id,expected_base,counted_base,variance_base,value_kobo,note").order("count_id"),
      supabase.from("stock_movements").select("ingredient_id,qty_base,reason,created_at").gte("created_at", since).limit(5000),
    ]);
    setIngs((i.data ?? []).map((x) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo), stock_base_qty: Number(x.stock_base_qty) })));
    setConvs((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
    setCounts((k.error ? [] : k.data ?? []).map((x) => ({ ...x, total_variance_kobo: Number(x.total_variance_kobo) })) as Count[]);
    setLines((l.error ? [] : l.data ?? []).map((x) => ({ ...x, expected_base: Number(x.expected_base), counted_base: Number(x.counted_base), variance_base: Number(x.variance_base), value_kobo: Number(x.value_kobo) })) as Line[]);
    setMoves((m.error ? [] : m.data ?? []).map((x) => ({ ...x, qty_base: Number(x.qty_base) })) as Movement[]);
  }, []);
  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!session) return <Shell><p className="text-muted-foreground">Please sign in first.</p><Link to="/app" className="underline text-sm">Go to sign-in</Link></Shell>;
  if (!ROLES.has(session.role)) return <Shell><p>Owners, purchasers and kitchen staff only.</p><Link className="underline" to="/app">Back</Link></Shell>;

  const losses = summarizeLosses(moves, ings);
  const pending = counts.filter((c) => c.status === "pending");
  const nameOf = new Map(ings.map((i) => [i.id, i]));

  async function decide(id: string, approve: boolean) {
    setMsg(null);
    const { error } = await supabase.rpc("decide_stock_count" as never, { p_count_id: id, p_approve: approve } as never);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: approve ? "Count approved. Stock has been corrected." : "Count rejected. Stock was not changed." });
    load();
  }

  return (
    <Shell>
      <Link to="/app" className="text-sm text-muted-foreground underline">← Home</Link>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Stock take</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The app works out what should be on the shelf: what you bought, minus what was used in sales or batches, minus wastage. Count what is really there and the difference shows what is missing.
      </p>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>}

      {isOwner && pending.length > 0 && (
        <section className="mt-6" data-testid="pending-counts">
          <h2 className="text-lg font-medium text-foreground">Waiting for your approval</h2>
          <ul className="mt-2 space-y-3">
            {pending.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{c.counted_by_name ?? "Staff"} counted on {when(c.created_at)}</span>
                  <span className={c.total_variance_kobo < 0 ? "text-sm font-medium text-destructive" : "text-sm text-foreground"}>{c.total_variance_kobo < 0 ? "Missing " : "Extra "}{formatNaira(Math.abs(c.total_variance_kobo))}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {lines.filter((l) => l.count_id === c.id && Math.abs(l.variance_base) >= 0.001).map((l) => {
                    const i = nameOf.get(l.ingredient_id);
                    return <li key={l.ingredient_id} className="text-foreground">{i?.name ?? "Ingredient"}: expected {fmtQty(l.expected_base)}, counted {fmtQty(l.counted_base)} {i?.base_unit} ({l.variance_base > 0 ? "+" : ""}{fmtQty(l.variance_base)}, {formatNaira(l.value_kobo)}){l.note ? ` — ${l.note}` : ""}</li>;
                  })}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => decide(c.id, true)}>Approve and correct stock</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(c.id, false)}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CountForm ings={ings} convs={convs} isOwner={isOwner} hasCounts={counts.length > 0} onDone={(t) => { setMsg({ ok: true, text: t }); load(); }} onError={(t) => setMsg({ ok: false, text: t })} />

      {session.role !== "cook" && (
        <section className="mt-10" data-testid="loss-report">
          <h2 className="text-lg font-medium text-foreground">Where stock went missing (last 30 days)</h2>
          {losses.rows.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No missing stock has been found by a stock-take in the last 30 days.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-foreground">{losses.unexplained_kobo > 0 ? "Missing" : "Extra"} in total: <strong>{formatNaira(Math.abs(losses.unexplained_kobo))}</strong>, at today's prices.</p>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
                {losses.rows.map((r) => (
                  <li key={r.ingredient_id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                    <span className="text-foreground">{r.name}</span>
                    <span className={r.lost_base > 0 ? "text-destructive" : "text-muted-foreground"}>
                      {r.lost_base > 0 ? `${fmtQty(r.lost_base)} ${r.base_unit} missing` : r.lost_base < 0 ? `${fmtQty(-r.lost_base)} ${r.base_unit} extra` : "no stock-take difference"} ({formatNaira(Math.abs(r.value_kobo))})
                      {r.by_hand_base !== 0 ? ` · ${fmtQty(Math.abs(r.by_hand_base))} ${r.base_unit} changed by hand` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Wastage you logged in this time is already taken off stock, so it is not counted as missing{losses.wastage_kobo > 0 ? ` (${formatNaira(losses.wastage_kobo)} logged)` : ""}.
            {losses.by_hand_count > 0 ? ` Stock was also changed by hand ${losses.by_hand_count} time${losses.by_hand_count === 1 ? "" : "s"}, which is shown above.` : ""}
            {" "}Only differences found by a stock-take count as missing, so count often. The opening count is a starting point and is not counted as a loss.
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium text-foreground">Recent counts</h2>
        {counts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No counts yet. Start with the opening count above.</p> : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {counts.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <span className="text-foreground">{when(c.created_at)} · {c.counted_by_name ?? "Staff"}{c.is_opening ? " · opening count" : ""}</span>
                <span className="text-muted-foreground">
                  {c.status === "pending" ? "Waiting for an owner" : c.status === "rejected" ? `Rejected${c.decided_by_name ? ` by ${c.decided_by_name}` : ""}` : `${c.total_variance_kobo < 0 ? "Missing " : c.total_variance_kobo > 0 ? "Extra " : "No difference "}${c.total_variance_kobo !== 0 ? formatNaira(Math.abs(c.total_variance_kobo)) : ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function CountForm({ ings, convs, isOwner, hasCounts, onDone, onError }: {
  ings: Ing[]; convs: CostConversion[]; isOwner: boolean; hasCounts: boolean; onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState(false);
  const [countNote, setCountNote] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => ings.map((i) => {
    const q = qty[i.id] ?? "";
    const u = unit[i.id] || i.base_unit;
    const base = q.trim() === "" ? null : countedToBase(i, Number(q), u, convs);
    const v = base === null ? null : variance(i.stock_base_qty, base, i.current_cost_kobo);
    return { i, q, u, base, v, bad: q.trim() !== "" && base === null };
  }), [ings, qty, unit, convs]);
  const entered = rows.filter((r) => r.q.trim() !== "" && r.base !== null);
  const missingNote = entered.filter((r) => r.v && !r.v.matches && !opening && !(note[r.i.id] ?? "").trim());
  const total = entered.reduce((s, r) => s + (r.v?.value_kobo ?? 0), 0);

  async function submit() {
    if (entered.length === 0) return onError("Count at least one ingredient.");
    if (rows.some((r) => r.bad)) return onError("One of the counts uses a unit with no conversion. Add the conversion on the Ingredients screen.");
    if (missingNote.length > 0) return onError(`Say why ${missingNote[0]!.i.name} is different.`);
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_stock_count" as never, {
      p_note: countNote.trim() || null, p_opening: isOwner && opening,
      p_lines: entered.map((r) => ({ ingredient_id: r.i.id, counted_base: r.base, entered_qty: Number(r.q), entered_unit: r.u, note: (note[r.i.id] ?? "").trim() || null })),
    } as never);
    setBusy(false);
    if (error) return onError(error.message);
    const r = data as { status?: string } | null;
    setQty({}); setNote({}); setUnit({}); setCountNote(""); setOpening(false);
    onDone(r?.status === "applied" ? "Count saved and stock corrected." : "Count sent to the owner for approval. Stock will be corrected when they approve it.");
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-4" data-testid="count-form">
      <h2 className="text-lg font-medium text-card-foreground">Count stock</h2>
      <p className="mt-1 text-xs text-muted-foreground">Enter what you can see on the shelf, in any unit the ingredient has, for example 4 mudu. Leave an ingredient blank if you are not counting it today. If the number is different from what the app expected, say why.</p>
      {isOwner && (
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={opening} onChange={(e) => setOpening(e.target.checked)} />
          <span><strong>This is the opening count.</strong> {hasCounts ? "Only tick this for a fresh start." : "Tick this the first time. It sets what is on the shelf now as the starting point, and is not treated as a loss."}</span>
        </label>
      )}
      <ul className="mt-3 divide-y divide-border">
        {rows.length === 0 && <li className="py-3 text-sm text-muted-foreground">No ingredients yet.</li>}
        {rows.map(({ i, q, u, v, bad }) => (
          <li key={i.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{i.name}</div>
                <div className="text-xs text-muted-foreground">App expects {fmtQty(i.stock_base_qty)} {i.base_unit}</div>
              </div>
              <div className="flex items-center gap-2">
                <Input aria-label={`Counted ${i.name}`} inputMode="decimal" className="h-9 w-24 text-right" placeholder="Counted" value={q} onChange={(e) => setQty((s) => ({ ...s, [i.id]: e.target.value.replace(/[^\d.]/g, "") }))} />
                <select aria-label={`Unit for ${i.name}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={u} onChange={(e) => setUnit((s) => ({ ...s, [i.id]: e.target.value }))}>
                  {unitsForIngredient(i, convs).map((x) => <option key={x} value={x}>{marketUnitLabel(x)}</option>)}
                </select>
              </div>
            </div>
            {bad && <p className="mt-1 text-xs text-destructive">No conversion for this unit.</p>}
            {v && (
              <div className="mt-1 text-sm">
                {v.matches ? <span className="text-muted-foreground">Matches.</span> : (
                  <>
                    <span className={v.diff_base < 0 ? "font-medium text-destructive" : "font-medium text-foreground"}>
                      {v.diff_base < 0 ? "Missing" : "Extra"} {fmtQty(Math.abs(v.diff_base))} {i.base_unit} ({formatNaira(Math.abs(v.value_kobo))})
                    </span>
                    {!opening && <Input aria-label={`Why ${i.name} is different`} className="mt-1 h-9" placeholder="Why is it different? (required)" value={note[i.id] ?? ""} onChange={(e) => setNote((s) => ({ ...s, [i.id]: e.target.value }))} />}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Input aria-label="Note for this count" className="mt-3" placeholder="Note for this count (optional)" value={countNote} onChange={(e) => setCountNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-foreground">{entered.length} counted{entered.length > 0 ? ` · ${total < 0 ? "missing " : total > 0 ? "extra " : "no difference "}${total !== 0 ? formatNaira(Math.abs(total)) : ""}` : ""}</span>
        <Button disabled={busy || entered.length === 0} onClick={submit}>{busy ? "Saving…" : isOwner ? "Save count and correct stock" : "Send count to the owner"}</Button>
      </div>
      {!isOwner && <p className="mt-2 text-xs text-muted-foreground">An owner has to approve the count before stock is corrected.</p>}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}
