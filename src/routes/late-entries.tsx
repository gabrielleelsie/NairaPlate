import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { lagosLocalToIso } from "@/lib/dish-prices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/late-entries")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Paper sales (late entry) — NairaPlate" },
      { name: "description", content: "Enter sales written on the paper fallback form and let the owner approve or reject them." },
      { property: "og:title", content: "Paper sales (late entry) — NairaPlate" },
      { property: "og:description", content: "Enter sales written on the paper fallback form and let the owner approve or reject them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LateEntriesScreen,
});

type Item = { id: string; dish_name: string; quantity: number; unit_price_kobo: number; line_total_kobo: number };
type Entry = {
  id: string; paper_reference: string; status: string; actual_sold_at: string; entered_at: string; delay_seconds: number;
  outage_reason: string; entered_by: string; approved_by: string | null; rejected_by: string | null; rejection_reason: string | null;
  source_shift_id: string | null; shift_resolution: string | null; payment_method: string; cash_kobo: number; transfer_kobo: number;
  total_kobo: number; posted_order_id: string | null; notes: string | null; late_entry_items: Item[];
};
const STATUS: Record<string, string> = { submitted: "Waiting for owner", needs_shift_review: "Needs shift review", posted: "Approved & posted", rejected: "Rejected", approved: "Approved", draft: "Draft" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const delay = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const BANNER = "This is a late-entry request. It is not yet a saved sale and does not change cash, stock or reports until an owner approves it.";

function LateEntriesScreen() {
  const { session, loading } = useStaffSession();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!session) return;
    const [e, s] = await Promise.all([
      supabase.from("late_entries").select("*, late_entry_items(*)").eq("business_id", session.businessId).order("created_at", { ascending: false }).limit(200),
      supabase.from("staff_users").select("id,display_name").eq("business_id", session.businessId),
    ]);
    if (e.error) setErr(e.error.message); else setErr("");
    setEntries((e.data ?? []) as Entry[]);
    setNames(Object.fromEntries((s.data ?? []).map((r: { id: string; display_name: string }) => [r.id, r.display_name])));
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !["cashier", "owner", "supa_admin"].includes(session.role))
    return <main className="p-6">Only cashiers and owners can use paper sales. <Link to="/app" className="underline">Home</Link></main>;
  const isOwner = session.role !== "cashier";
  const who = (id: string | null) => (id && names[id]) || (id === session.userId ? `${session.name} (me)` : "Staff");
  const by = (st: string[]) => entries.filter((e) => st.includes(e.status));

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Paper sales</h1>
        <div className="flex gap-3 text-sm"><Link to="/pos" className="underline">Till</Link><Link to="/app" className="underline">Home</Link></div>
      </div>
      {err && <p className="text-destructive">{err}</p>}
      <Tabs defaultValue={isOwner ? "review" : "new"}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="new">Enter paper sale</TabsTrigger>
          <TabsTrigger value="review">Waiting ({by(["submitted", "needs_shift_review"]).length})</TabsTrigger>
          <TabsTrigger value="done">Posted & rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="new"><NewEntry onDone={load} /></TabsContent>
        <TabsContent value="review" className="space-y-2">
          {by(["submitted", "needs_shift_review"]).length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
          {by(["needs_shift_review", "submitted"]).sort((a, b) => (a.status === "needs_shift_review" ? -1 : 1) - (b.status === "needs_shift_review" ? -1 : 1))
            .map((e) => <EntryCard key={e.id} e={e} who={who} isOwner={isOwner} onDone={load} />)}
        </TabsContent>
        <TabsContent value="done" className="space-y-2">
          {by(["posted", "rejected", "approved"]).length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {by(["posted", "rejected", "approved"]).map((e) => <EntryCard key={e.id} e={e} who={who} isOwner={false} onDone={load} />)}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function EntryCard({ e, who, isOwner, onDone }: { e: Entry; who: (id: string | null) => string; isOwner: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const needsShift = e.status === "needs_shift_review";

  async function approve() {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("approve_and_post_late_entry", { p_id: e.id, p_shift_resolution: needsShift ? res : null });
    setBusy(false);
    if (error) setMsg(error.message); else onDone();
  }
  async function reject() {
    if (!confirm("Reject this paper sale? No sale will be created.")) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("reject_late_entry", { p_id: e.id, p_reason: reason.trim() });
    setBusy(false);
    if (error) setMsg(error.message); else onDone();
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Paper ref {e.paper_reference} · {formatNaira(Number(e.total_kobo))} · {e.payment_method}</div>
          <div className="text-muted-foreground">Sold {when(e.actual_sold_at)} · entered {when(e.entered_at)} · {delay(e.delay_seconds)} late · by {who(e.entered_by)}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${needsShift ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>{STATUS[e.status] ?? e.status}</span>
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>{open ? "Hide" : "Details"}</Button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <p>Reason: {e.outage_reason}{e.notes ? ` · Notes: ${e.notes}` : ""}</p>
          <table className="w-full text-left">
            <thead className="text-muted-foreground"><tr><th>Dish</th><th>Qty</th><th>Price then</th><th className="text-right">Line</th></tr></thead>
            <tbody>{e.late_entry_items.map((i) => (
              <tr key={i.id}><td>{i.dish_name}</td><td>{Number(i.quantity)}</td><td>{formatNaira(Number(i.unit_price_kobo))}</td><td className="text-right">{formatNaira(Number(i.line_total_kobo))}</td></tr>
            ))}</tbody>
          </table>
          <p>Cash {formatNaira(Number(e.cash_kobo))} · Transfer {formatNaira(Number(e.transfer_kobo))}{Number(e.transfer_kobo) > 0 && e.status !== "rejected" ? " (stays pending until confirmed — never marked paid from paper)" : ""}</p>
          {e.status === "posted" && <p>Approved by {who(e.approved_by)} · order #{e.posted_order_id?.slice(0, 8)} · {e.shift_resolution === "open_shift_direct" ? "posted into the open shift" : e.shift_resolution === "closed_shift_included" ? "cash was already in the closed shift's count" : "late cash recorded against the closed shift"}</p>}
          {e.status === "rejected" && <p className="text-destructive">Rejected by {who(e.rejected_by)}: "{e.rejection_reason}". No sale, stock or cash change was made.</p>}
          {isOwner && (e.status === "submitted" || needsShift) && (
            <div className="space-y-3">
              {needsShift && (
                <fieldset className="space-y-1 rounded border-2 border-destructive/40 p-2">
                  <legend className="px-1 font-medium">The shift at that time is closed (or none was open). Was this cash counted at close?</legend>
                  <label className="flex gap-2"><input type="radio" name={`r-${e.id}`} checked={res === "closed_shift_included"} onChange={() => setRes("closed_shift_included")} />Yes — the cash was included in the count at close</label>
                  <label className="flex gap-2"><input type="radio" name={`r-${e.id}`} checked={res === "closed_shift_late_cash"} onChange={() => setRes("closed_shift_late_cash")} />No — record it as late cash against that closed shift</label>
                  <p className="text-xs text-muted-foreground">Not sure? Reject it instead. The closed shift's count is never changed and cash is never moved to another shift.</p>
                </fieldset>
              )}
              <Button disabled={busy || (needsShift && !res)} onClick={approve}>Approve & post {formatNaira(Number(e.total_kobo))}</Button>
              <div className="space-y-1">
                <Label htmlFor={`rej-${e.id}`}>Reject reason (at least 5 letters)</Label>
                <Textarea id={`rej-${e.id}`} value={reason} onChange={(ev) => setReason(ev.target.value)} />
                <Button variant="outline" disabled={busy || reason.trim().length < 5} onClick={reject}>Reject</Button>
              </div>
            </div>
          )}
          {msg && <p className="text-destructive">{msg}</p>}
        </div>
      )}
    </div>
  );
}

type Dish = { id: string; name: string };
function NewEntry({ onDone }: { onDone: () => void }) {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [paper, setPaper] = useState("");
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ recipe_id: string; quantity: string }[]>([{ recipe_id: "", quantity: "1" }]);
  const [pay, setPay] = useState<"cash" | "transfer" | "split">("cash");
  const [cashN, setCashN] = useState("");
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<string>("");

  useEffect(() => {
    supabase.from("recipes").select("id,name").eq("is_current", true).order("name").then(({ data }) => setDishes((data ?? []) as Dish[]));
  }, []);
  const iso = at ? lagosLocalToIso(at) : null;
  // Preview prices from history at the sale time; the database re-checks and freezes them on submit.
  useEffect(() => {
    if (!iso) return;
    const ids = [...new Set(lines.map((l) => l.recipe_id).filter(Boolean))];
    Promise.all(ids.map(async (id) => {
      const { data } = await supabase.rpc("dish_price_at", { p_recipe_id: id, p_at: iso });
      const row = Array.isArray(data) ? data[0] : data;
      return [id, row?.price_kobo != null ? Number(row.price_kobo) : null] as const;
    })).then((r) => setPrices(Object.fromEntries(r)));
  }, [iso, lines]);

  const total = useMemo(() => lines.reduce((s, l) => s + Math.round((prices[l.recipe_id] ?? 0) * (Number(l.quantity) || 0)), 0), [lines, prices]);
  const cashK = pay === "cash" ? total : pay === "transfer" ? 0 : nairaToKobo(cashN);
  const trK = total - cashK;
  const ok = paper.trim().length >= 2 && reason.trim().length >= 3 && iso && lines.every((l) => l.recipe_id && Number(l.quantity) > 0) && total > 0 && (pay !== "split" || (cashK > 0 && trK > 0));

  async function submit() {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("submit_late_entry", {
      p_client_sale_id: clientId, p_paper_reference: paper.trim(), p_actual_sold_at: iso, p_outage_reason: reason.trim(),
      p_payment_method: pay, p_cash_kobo: cashK, p_transfer_kobo: trK,
      p_items: lines.map((l) => ({ recipe_id: l.recipe_id, quantity: Number(l.quantity) })), p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    const r = data as { status?: string; already_submitted?: boolean };
    setDone(r.already_submitted ? "This paper sale was already sent. Nothing new was created." : r.status === "needs_shift_review"
      ? "Sent. The shift at that time is closed, so the owner must review it." : "Sent to the owner for approval.");
    setPaper(""); setAt(""); setReason(""); setNotes(""); setLines([{ recipe_id: "", quantity: "1" }]); setCashN(""); setClientId(crypto.randomUUID());
    onDone();
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md border-2 border-accent bg-accent/20 p-3 font-medium">{BANNER}</p>
      {done && <p className="rounded-md border p-2">{done} It is not a saved sale until approved.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="paper">Paper form reference</Label><Input id="paper" value={paper} onChange={(e) => setPaper(e.target.value)} placeholder="e.g. FB-104" /></div>
        <div className="space-y-1"><Label htmlFor="at">Actual sale time (Nigeria time)</Label><Input id="at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="why">Why it was on paper</Label><Input id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Network down, power cut…" /></div>
      <p className="text-xs text-muted-foreground">Only sales from the last 72 hours. Prices are the ones in force at the sale time.</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select aria-label="Dish" className="h-10 flex-1 rounded-md border bg-background px-2" value={l.recipe_id}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, recipe_id: e.target.value } : x)))}>
              <option value="">Choose dish…</option>
              {dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Input aria-label="Quantity" className="w-20" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <span className="w-24 text-right text-sm">{l.recipe_id && iso ? (prices[l.recipe_id] == null ? "no price then" : formatNaira(prices[l.recipe_id]!)) : ""}</span>
            {lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines([...lines, { recipe_id: "", quantity: "1" }])}>Add dish</Button>
      </div>
      <div className="flex gap-4 text-sm">
        {(["cash", "transfer", "split"] as const).map((p) => <label key={p} className="flex items-center gap-1"><input type="radio" checked={pay === p} onChange={() => setPay(p)} />{p === "split" ? "Split" : p === "cash" ? "Cash" : "Transfer"}</label>)}
      </div>
      {pay === "split" && <div className="space-y-1"><Label htmlFor="cash">Cash part (₦) — transfer is the rest ({formatNaira(Math.max(0, trK))})</Label><Input id="cash" inputMode="decimal" value={cashN} onChange={(e) => setCashN(e.target.value)} /></div>}
      {pay !== "cash" && <p className="text-xs text-muted-foreground">Transfer stays pending until confirmed. Writing "transfer" on paper does not make it paid.</p>}
      <div className="space-y-1"><Label htmlFor="notes">Notes (optional)</Label><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <p className="font-medium">Total at the sale time: {formatNaira(total)}</p>
      {msg && <p className="text-destructive">{msg}</p>}
      <Button disabled={busy || !ok} onClick={submit}>Send to owner for approval</Button>
    </div>
  );
}
