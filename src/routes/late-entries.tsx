import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { ReceiptPhotos } from "@/components/ReceiptPhotos";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { lagosLocalToIso } from "@/lib/dish-prices";
import { reasonLabel, type CostPreview } from "@/lib/late-entry-cost";
import { approvalArgs, approvalProblem, awaitingTransfer, RESOLUTION_LABEL, shiftSituation, transferProblem, REASON_MIN, canMarkLost, isTransferLost, lostProblem, LOSS_REASON_MIN, type ShiftSituation } from "@/lib/late-entry-rules";
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
  const [shiftStatus, setShiftStatus] = useState<Record<string, string>>({});
  const [orderStatus, setOrderStatus] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!session) return;
    const [e, s] = await Promise.all([
      supabase.from("late_entries").select("*, late_entry_items(*)").eq("business_id", session.businessId).order("created_at", { ascending: false }).limit(200),
      supabase.from("staff_users").select("id,display_name").eq("business_id", session.businessId),
    ]);
    if (e.error) setErr(e.error.message); else setErr("");
    const list = (e.data ?? []) as Entry[];
    setEntries(list);
    // The shift each sale really belongs to (open or closed now) and the order each posted sale made (paid or awaiting its transfer).
    const sids = [...new Set(list.map((x) => x.source_shift_id).filter((x): x is string => !!x))];
    const oids = list.map((x) => x.posted_order_id).filter((x): x is string => !!x);
    const [d, o] = await Promise.all([
      sids.length ? supabase.from("cash_drawers").select("id,status").in("id", sids) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
      oids.length ? supabase.from("orders").select("id,status").in("id", oids) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    ]);
    setShiftStatus(Object.fromEntries((d.data ?? []).map((r: { id: string; status: string }) => [r.id, r.status])));
    setOrderStatus(Object.fromEntries((o.data ?? []).map((r: { id: string; status: string }) => [r.id, r.status])));
    setNames(Object.fromEntries((s.data ?? []).map((r: { id: string; display_name: string }) => [r.id, r.display_name])));
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="p-6">Loading…</main>;
  if (!session || !["cashier", "owner", "supa_admin"].includes(session.role))
    return <main className="p-6">Only cashiers and owners can use paper sales. <Link to="/app" className="underline">Home</Link></main>;
  const isOwner = session.role !== "cashier";
  const who = (id: string | null) => (id && names[id]) || (id === session.userId ? `${session.name} (me)` : "Staff");
  const by = (st: string[]) => entries.filter((e) => st.includes(e.status));
  const waitingTransfer = entries.filter((e) => awaitingTransfer(e, e.posted_order_id ? orderStatus[e.posted_order_id] : undefined));
  const card = (e: Entry, owner: boolean) => (
    <EntryCard key={e.id} e={e} who={who} isOwner={owner} onDone={load} biz={session.businessId} role={session.role}
      shiftStatus={e.source_shift_id ? shiftStatus[e.source_shift_id] : undefined}
      orderStatus={e.posted_order_id ? orderStatus[e.posted_order_id] : undefined} />
  );

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
          <TabsTrigger value="transfer">Awaiting transfer ({waitingTransfer.length})</TabsTrigger>
          <TabsTrigger value="done">Posted & rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="new"><NewEntry onDone={load} /></TabsContent>
        <TabsContent value="review" className="space-y-2">
          {by(["submitted", "needs_shift_review"]).length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
          {by(["needs_shift_review", "submitted"]).sort((a, b) => (a.status === "needs_shift_review" ? -1 : 1) - (b.status === "needs_shift_review" ? -1 : 1))
            .map((e) => card(e, isOwner))}
        </TabsContent>
        <TabsContent value="transfer" className="space-y-2">
          <p className="text-sm text-muted-foreground">Paper sales paid by transfer or split stay <strong>awaiting payment</strong> until an owner confirms the money arrived. A paper ticket is not proof of payment.</p>
          {waitingTransfer.length === 0 && <p className="text-muted-foreground">No paper transfers are waiting.</p>}
          {waitingTransfer.map((e) => card(e, isOwner))}
        </TabsContent>
        <TabsContent value="done" className="space-y-2">
          {by(["posted", "rejected", "approved"]).length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {by(["posted", "rejected", "approved"]).map((e) => card(e, false))}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function EntryCard({ e, who, isOwner, onDone, biz, role, shiftStatus, orderStatus }: { e: Entry; who: (id: string | null) => string; isOwner: boolean; onDone: () => void; biz: string; role: string; shiftStatus?: string | undefined; orderStatus?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState("");
  const [reason, setReason] = useState("");
  const [shiftNote, setShiftNote] = useState("");
  const [proof, setProof] = useState("");
  const [tReason, setTReason] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [showLost, setShowLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [useEstimate, setUseEstimate] = useState(false);
  const [estReason, setEstReason] = useState("");
  const situation: ShiftSituation = shiftSituation(e, shiftStatus);
  const needsShift = situation !== "open";
  const needsTransfer = e.payment_method !== "cash" && Number(e.transfer_kobo) > 0;
  const waiting = awaitingTransfer(e, orderStatus);
  const lost = isTransferLost(e, orderStatus);
  const canLose = canMarkLost(e, orderStatus);
  const pending = isOwner && (e.status === "submitted" || e.status === "needs_shift_review");

  useEffect(() => {
    if (!open || !pending) return;
    supabase.rpc("late_entry_cost_preview", { p_id: e.id }).then(({ data, error }) => { if (!error) setPreview(data as CostPreview); });
  }, [open, pending, e.id]);

  const unknown = preview != null && !preview.is_complete;
  const estimateOk = !unknown || (useEstimate && estReason.trim().length >= 5);
  const shiftProblem = approvalProblem(situation, res, shiftNote);

  async function approve() {
    setBusy(true); setMsg("");
    const args: Record<string, unknown> = { p_id: e.id, ...approvalArgs(situation, res, shiftNote) };
    if (unknown && useEstimate) { args["p_cost_decision"] = "estimate_current_price"; args["p_estimate_reason"] = estReason.trim(); }
    const { error } = await supabase.rpc("approve_and_post_late_entry", args as never);
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

  async function confirmTransfer() {
    if (!e.posted_order_id) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("confirm_paper_transfer", { p_order_id: e.posted_order_id, p_proof: proof.trim(), p_reason: tReason.trim() });
    setBusy(false);
    if (error) setMsg(error.message); else { setProof(""); setTReason(""); onDone(); }
  }

  async function markLost() {
    if (!e.posted_order_id) return;
    if (!confirm(`Close this sale as "transfer lost"? ${formatNaira(Number(e.transfer_kobo))} will be recorded as not received, the cash of ${formatNaira(Number(e.cash_kobo))} is kept, and this cannot be undone.`)) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("mark_paper_transfer_lost", { p_order_id: e.posted_order_id, p_reason: lostReason.trim() });
    setBusy(false);
    if (error) setMsg(error.message); else { setLostReason(""); setShowLost(false); onDone(); }
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Paper ref {e.paper_reference} · {formatNaira(Number(e.total_kobo))} · {e.payment_method}</div>
          <div className="text-muted-foreground">Sold {when(e.actual_sold_at)} · entered {when(e.entered_at)} · {delay(e.delay_seconds)} late · by {who(e.entered_by)}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${pending && needsShift ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>{lost ? "Transfer lost" : waiting ? "Awaiting transfer" : STATUS[e.status] ?? e.status}</span>
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
          <p>Cash {formatNaira(Number(e.cash_kobo))} · Transfer {formatNaira(Number(e.transfer_kobo))}{Number(e.transfer_kobo) > 0 && e.status !== "rejected" ? (e.status === "posted" ? (waiting ? " (awaiting payment until an owner confirms the transfer)" : lost ? " (transfer never arrived: closed as lost, cash kept)" : " (transfer confirmed)") : " (will be posted as awaiting payment until an owner confirms the transfer; never marked paid from paper)") : ""}</p>
          {e.status === "posted" && <p>Approved by {who(e.approved_by)} · order #{e.posted_order_id?.slice(0, 8)} · {RESOLUTION_LABEL[e.shift_resolution ?? ""] ?? e.shift_resolution}{e.notes ? ` · reason: ${e.notes}` : ""}</p>}
          {waiting && (
            isOwner || role !== "cashier" ? (
              <div className="space-y-2 rounded border-2 border-accent p-2">
                <p className="font-medium">Confirm the transfer of {formatNaira(Number(e.transfer_kobo))} arrived</p>
                <p className="text-xs text-muted-foreground">Only after you have seen the money in the bank. This marks the order paid and cannot be undone.</p>
                <Label htmlFor={`proof-${e.id}`}>Proof: bank reference or short note (at least {REASON_MIN} characters)</Label>
                <Input id={`proof-${e.id}`} value={proof} onChange={(ev) => setProof(ev.target.value)} placeholder="e.g. UBA ref 123456789" />
                <Label htmlFor={`treason-${e.id}`}>Reason (at least {REASON_MIN} characters)</Label>
                <Input id={`treason-${e.id}`} value={tReason} onChange={(ev) => setTReason(ev.target.value)} placeholder="e.g. Customer paid at 3pm" />
                {transferProblem(proof, tReason) && (proof || tReason) && <p className="text-xs text-muted-foreground">{transferProblem(proof, tReason)}</p>}
                <Button disabled={busy || !!transferProblem(proof, tReason)} onClick={confirmTransfer}>Confirm transfer received</Button>
              </div>
            ) : <p className="rounded border p-2 text-muted-foreground">Waiting for an owner to confirm the transfer.</p>
          )}
          {canLose && role !== "cashier" && (
            <div className="space-y-2 rounded border p-2">
              <Button size="sm" variant="outline" onClick={() => setShowLost(!showLost)}>{showLost ? "Hide" : "The transfer never arrived"}</Button>
              {showLost && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Use this only when the customer paid the cash part and the transfer part will never arrive. The transfer is recorded as lost, the cash is kept, and the sale is closed. This cannot be undone, and the cash part cannot be refunded here.</p>
                  <Label htmlFor={`lost-${e.id}`}>Reason (at least {LOSS_REASON_MIN} characters)</Label>
                  <Input id={`lost-${e.id}`} value={lostReason} onChange={(ev) => setLostReason(ev.target.value)} placeholder="e.g. Customer promised, never paid after 3 days" />
                  {lostProblem(lostReason) && lostReason && <p className="text-xs text-muted-foreground">{lostProblem(lostReason)}</p>}
                  <Button variant="outline" disabled={busy || !!lostProblem(lostReason)} onClick={markLost}>Mark transfer as lost</Button>
                </div>
              )}
            </div>
          )}
          {lost && <p className="rounded border p-2 text-sm">The transfer of {formatNaira(Number(e.transfer_kobo))} never arrived and was closed as lost. The cash of {formatNaira(Number(e.cash_kobo))} was kept. The reason is in the audit trail.</p>}
          {e.status === "rejected" && <p className="text-destructive">Rejected by {who(e.rejected_by)}: "{e.rejection_reason}". No sale, stock or cash change was made.</p>}
          <ReceiptPhotos type="late_entry" recordId={e.id} businessId={biz} role={role} />
          {pending && (
            <div className="space-y-3">
              {preview && preview.is_complete && (
                <div className="rounded border p-2">
                  {preview.lines.map((l, i) => (
                    <p key={i} className="font-medium">{l.dish_name}: food cost {formatNaira(Math.round(Number(l.cost.total_cost_per_plate_kobo)))} per plate</p>
                  ))}
                  <p className="text-xs text-muted-foreground">{preview.overall_status === "sale_time_backfilled"
                    ? "Costed at the sale time using reconstructed purchase history."
                    : "Costed using ingredient prices active at the sale time."}</p>
                </div>
              )}
              {unknown && preview && (
                <div className="space-y-2 rounded border-2 border-destructive/40 p-2">
                  <p className="font-semibold">Food cost unknown at sale time</p>
                  <p>NairaPlate could not find a historical cost for:{" "}
                    {[...new Map(preview.lines.flatMap((l) => l.cost.unresolved_ingredients).map((u) => [u.ingredient_name ?? "recipe", u])).values()]
                      .map((u) => `${u.ingredient_name ?? "the recipe"} (${reasonLabel(u.reason)})`).join(", ")}.</p>
                  <p className="text-xs text-muted-foreground">This paper sale cannot be posted with a historical food cost. To hold it for review, leave it here; nothing is saved.</p>
                  <label className="flex gap-2"><input type="checkbox" checked={useEstimate} onChange={(ev) => setUseEstimate(ev.target.checked)} />Use today's cost as an estimate</label>
                  {useEstimate && (
                    <div className="space-y-1">
                      <p className="text-xs"><strong>Estimated cost, not historical cost.</strong> This freezes today's calculated cost on the approved sale and labels it "Estimated — today's prices".</p>
                      <Label htmlFor={`est-${e.id}`}>Reason (at least 5 letters)</Label>
                      <Input id={`est-${e.id}`} value={estReason} onChange={(ev) => setEstReason(ev.target.value)} placeholder="e.g. No historical oil cost" />
                    </div>
                  )}
                </div>
              )}
              {needsTransfer && <p className="rounded border p-2 text-xs">This sale was paid {e.payment_method === "split" ? "partly " : ""}by transfer, so it will be posted as <strong>awaiting payment</strong>. You confirm the transfer later, in the Awaiting transfer tab.</p>}
              {situation === "open" && <p className="text-xs text-muted-foreground">The shift this sale happened in is still open, so it is posted straight into that shift.</p>}
              {situation === "closed" && (
                <fieldset className="space-y-1 rounded border-2 border-destructive/40 p-2">
                  <legend className="px-1 font-medium">The shift this sale happened in is now closed. Was this cash counted at close?</legend>
                  <label className="flex gap-2"><input type="radio" name={`r-${e.id}`} checked={res === "closed_shift_included"} onChange={() => setRes("closed_shift_included")} />Yes: the cash was included in the count at close</label>
                  <label className="flex gap-2"><input type="radio" name={`r-${e.id}`} checked={res === "closed_shift_late_cash"} onChange={() => setRes("closed_shift_late_cash")} />No: add it to that closed shift as late cash (an adjustment beside the original count)</label>
                  <Label htmlFor={`sn-${e.id}`}>Reason for your choice (at least {REASON_MIN} characters)</Label>
                  <Input id={`sn-${e.id}`} value={shiftNote} onChange={(ev) => setShiftNote(ev.target.value)} placeholder="e.g. Cashier confirms it was in the drawer at close" />
                  <p className="text-xs text-muted-foreground">Not sure? Reject it instead. The closed shift's original count is never rewritten, and the cash is never counted in a different shift.</p>
                </fieldset>
              )}
              {situation === "outside" && (
                <fieldset className="space-y-1 rounded border-2 border-destructive/40 p-2">
                  <legend className="px-1 font-medium">No shift covered the time of this sale.</legend>
                  <p>You can reject it, or approve it as <strong>cash outside any shift</strong>. The cash is recorded on the sale but belongs to no drawer.</p>
                  <Label htmlFor={`sn-${e.id}`}>Reason (at least {REASON_MIN} characters)</Label>
                  <Input id={`sn-${e.id}`} value={shiftNote} onChange={(ev) => setShiftNote(ev.target.value)} placeholder="e.g. Night sale, no shift was open" />
                </fieldset>
              )}
              <Button disabled={busy || !!shiftProblem || !estimateOk} onClick={approve}>
                {unknown && useEstimate ? "Approve with estimated cost" : situation === "outside" ? "Approve as cash outside any shift" : "Approve & post"} {formatNaira(Number(e.total_kobo))}
              </Button>
              {shiftProblem && (res || shiftNote) && <p className="text-xs text-muted-foreground">{shiftProblem}</p>}
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
      const { data } = await supabase.rpc("dish_price_strict", { p_dish: id, p_at: iso });
      const row = Array.isArray(data) ? data[0] : data;
      return [id, row?.price_kobo != null ? Number(row.price_kobo) : null] as const;
    })).then((r) => setPrices(Object.fromEntries(r)));
  }, [iso, lines]);

  const total = useMemo(() => lines.reduce((s, l) => s + Math.round((prices[l.recipe_id] ?? 0) * (Number(l.quantity) || 0)), 0), [lines, prices]);
  const cashK = pay === "cash" ? total : pay === "transfer" ? 0 : nairaToKobo(cashN);
  const trK = total - cashK;
  const missingPrice = lines.filter((l) => l.recipe_id && iso && prices[l.recipe_id] == null).map((l) => dishes.find((d) => d.id === l.recipe_id)?.name ?? "a dish");
  const ok = paper.trim().length >= 2 && reason.trim().length >= 3 && iso && lines.every((l) => l.recipe_id && Number(l.quantity) > 0) && total > 0 && missingPrice.length === 0 && (pay !== "split" || (cashK > 0 && trK > 0));

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
            <span className="w-24 text-right text-sm">{l.recipe_id && iso ? (prices[l.recipe_id] == null ? "no menu price then" : formatNaira(prices[l.recipe_id]!)) : ""}</span>
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
      {missingPrice.length > 0 && <p className="rounded border-2 border-destructive/40 p-2 text-sm">There was no menu price on record at that time for {[...new Set(missingPrice)].join(", ")}, so this sale cannot be entered. A later price, or today's price, is never used for an earlier sale.</p>}
      <p className="font-medium">Total at the sale time: {formatNaira(total)}</p>
      {msg && <p className="text-destructive">{msg}</p>}
      <Button disabled={busy || !ok} onClick={submit}>Send to owner for approval</Button>
    </div>
  );
}
