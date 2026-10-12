import { createFileRoute, Link } from "@tanstack/react-router";
import { FeatureGate } from "@/components/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession, MARKET_UNIT_OPTIONS, marketUnitLabel } from "@/lib/staff-session";
import {
  convertAndCostIngredient, formatNaira,
  type CostIngredient, type CostConversion,
} from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { costToShow, differingCostNotice } from "@/lib/saved-figures";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  WASTAGE_DELETE_BUTTON, WASTAGE_CONFIRM_TITLE, WASTAGE_HISTORY_EMPTY, WASTAGE_HISTORY_HEADING, WASTAGE_HISTORY_LIMIT, WASTAGE_HISTORY_SUBLINE,
  WASTAGE_REMOVED_MESSAGE, canDeleteWastage, canSeeStaffNames, confirmParagraphs, recordedByLabel, removeFailedMessage, type WastageRow,
} from "@/lib/wastage-history";

export const Route = createFileRoute("/wastage")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Log wastage — NairaPlate" },
      { name: "description", content: "Record spoiled or wasted ingredients and what they cost." },
      { property: "og:title", content: "Log wastage — NairaPlate" },
      { property: "og:description", content: "Record spoiled or wasted ingredients and what they cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FeatureGate feature="wastage"><WastageScreen /></FeatureGate>,
});

const ROLES = new Set(["cook", "purchaser", "owner", "supa_admin"]);
const REASONS = ["Spoilage", "Over-cooking", "Contamination", "Other"];

function WastageScreen() {
  const { loading, session } = useStaffSession();
  const [ingredients, setIngredients] = useState<CostIngredient[]>([]);
  const [conversions, setConversions] = useState<CostConversion[]>([]);
  const [ingId, setIngId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<WastageRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  // Ids of entries that have a stock record. null means the check failed, so Delete is hidden rather than promising a stock return.
  const [withStockRecord, setWithStockRecord] = useState<Set<string> | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WastageRow | null>(null);
  const [histMsg, setHistMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("ingredients").select("id,name,base_unit,current_cost_kobo").order("name"),
      supabase.from("unit_conversions").select("ingredient_id,market_unit,base_qty"),
    ]).then(([i, c]) => {
      setIngredients((i.data ?? []).map((x) => ({ ...x, current_cost_kobo: Number(x.current_cost_kobo) })));
      setConversions((c.data ?? []).map((x) => ({ ...x, base_qty: Number(x.base_qty) })));
    });
  }, []);

  const role = session?.role ?? null;
  const userId = session?.userId ?? null;
  const ownerView = canDeleteWastage(role);

  async function loadHistory() {
    if (!role) return;
    setHistoryError(null);
    const { data, error } = await supabase.from("wastage_logs")
      .select("id,ingredient_id,qty,unit,cost_kobo,reason,logged_by,created_at")
      .order("created_at", { ascending: false }).limit(WASTAGE_HISTORY_LIMIT);
    if (error) { setHistory([]); setHistoryError("Could not load the wastage history: " + error.message); return; }
    const rows: WastageRow[] = (data ?? []).map((x) => ({ ...x, qty: Number(x.qty), cost_kobo: Number(x.cost_kobo) }));
    setHistory(rows);
    if (canSeeStaffNames(role)) {
      const { data: staff } = await supabase.from("staff_users").select("id,display_name");
      setNames(Object.fromEntries((staff ?? []).map((st) => [st.id, st.display_name])));
    }
    if (canDeleteWastage(role) && rows.length) {
      const { data: mv, error: mvErr } = await supabase.from("stock_movements").select("ref_id").eq("reason", "wastage").in("ref_id", rows.map((r) => r.id));
      setWithStockRecord(mvErr ? null : new Set((mv ?? []).map((m) => String(m.ref_id))));
    } else setWithStockRecord(new Set());
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHistory(); }, [role]);

  async function doDelete() {
    const row = pendingDelete;
    if (!row) return;
    setBusy(true); setHistMsg(null);
    const { data, error } = await supabase.from("wastage_logs").delete().eq("id", row.id).select("id");
    setBusy(false); setPendingDelete(null);
    if (error) return setHistMsg({ ok: false, text: removeFailedMessage(error.message) });
    if (!data || data.length === 0) return setHistMsg({ ok: false, text: removeFailedMessage(null) });
    setHistMsg({ ok: true, text: WASTAGE_REMOVED_MESSAGE });
    await loadHistory();
  }

  const ing = ingredients.find((i) => i.id === ingId);
  // The ONLY costing on this screen — the shared function from costing.ts.
  const cost = useMemo(
    () => (ingId && unit && Number(qty) > 0
      ? convertAndCostIngredient({ ingredientId: ingId, qty: Number(qty), unit, ingredients, conversions })
      : null),
    [ingId, unit, qty, ingredients, conversions],
  );

  async function submit() {
    if (!session || !cost) return;
    if (cost.error || cost.cost_kobo === null) return setMsg({ ok: false, text: cost.error ?? "No conversion set up." });
    setBusy(true); setMsg(null);
    const cost_kobo = Math.round(cost.cost_kobo);
    // Ask for the saved row back: after S4 the database works out the cost itself and may replace this screen's figure.
    const { data: saved, error } = await supabase.from("wastage_logs").insert({
      business_id: session.businessId, ingredient_id: ingId, qty: Number(qty), unit,
      cost_kobo, reason, logged_by: session.userId,
    }).select("cost_kobo").maybeSingle();
    setBusy(false);
    if (error) return setMsg({ ok: false, text: "Not saved: " + error.message });
    const savedCost = costToShow(saved?.cost_kobo, cost_kobo);
    const notice = differingCostNotice(saved?.cost_kobo, cost_kobo, formatNaira);
    setMsg({ ok: true, text: `Logged ${qty} ${marketUnitLabel(unit)} of ${ing?.name} — cost ${formatNaira(savedCost)}. Stock has been reduced.${notice ? " " + notice : ""}` });
    setQty("");
    loadHistory();
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Kitchen, purchasing and owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Log wastage</h1><Link className="underline" to="/app">Home</Link></div>
      <div className="space-y-1"><Label htmlFor="w-ing">Ingredient</Label>
        <select id="w-ing" className={sel} value={ingId} onChange={(e) => { setIngId(e.target.value); setUnit(""); }}>
          <option value="">Choose…</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1"><Label htmlFor="w-qty">Quantity</Label>
          <Input id="w-qty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="w-unit">Unit</Label>
          <select id="w-unit" className={sel} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!ing}>
            <option value="">Choose…</option>
            {MARKET_UNIT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="w-reason">Reason</Label>
        <select id="w-reason" className={sel} value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r}>{r}</option>)}
        </select></div>
      {cost?.error && <p className="text-sm text-destructive" role="alert">{cost.error}</p>}
      {cost && !cost.error && <p>Cost of this waste: <strong>{formatNaira(Math.round(cost.cost_kobo ?? 0))}</strong></p>}
      <Button className="w-full" disabled={busy || !cost || !!cost.error} onClick={submit}>Log wastage</Button>
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <section className="space-y-2 pt-4" aria-label={WASTAGE_HISTORY_HEADING}>
        <h2 className="font-semibold">{WASTAGE_HISTORY_HEADING}</h2>
        <p className="text-sm text-muted-foreground">{WASTAGE_HISTORY_SUBLINE}</p>
        {histMsg && <p className={histMsg.ok ? "text-primary" : "text-destructive"} role="status">{histMsg.text}</p>}
        {historyError && <p className="text-sm text-destructive" role="alert">{historyError}</p>}
        <ul className="space-y-2">
          {!historyError && history.length === 0 && <li className="text-sm text-muted-foreground">{WASTAGE_HISTORY_EMPTY}</li>}
          {history.map((w) => (
            <li key={w.id} className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between font-medium">
                <span>{ingredients.find((i) => i.id === w.ingredient_id)?.name ?? "Ingredient"}</span>
                <span>{new Date(w.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <p className="text-muted-foreground">{Number(w.qty)} {marketUnitLabel(w.unit)} · {formatNaira(w.cost_kobo)}{w.reason ? ` · ${w.reason}` : ""}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Recorded by {recordedByLabel(w, role, userId, names)}</p>
                {ownerView && withStockRecord !== null && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setHistMsg(null); setPendingDelete(w); }}>{WASTAGE_DELETE_BUTTON}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{WASTAGE_CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pendingDelete && confirmParagraphs(!!withStockRecord?.has(pendingDelete.id)).map((t) => <p key={t}>{t}</p>)}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doDelete(); }}>{WASTAGE_DELETE_BUTTON}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
