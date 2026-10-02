import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { isOwnerRole } from "@/lib/catering-order";
import {
  SHIFT_COLUMNS, adjustedCount, adjustedDiscrepancy, adjustmentDelta, canAdjust, canForceClose, normaliseAdjustments, normaliseShifts, reasonOk, shiftLabel,
  type ShiftAdjustment, type ShiftRow,
} from "@/lib/cash-drawer";
import { entryWhen } from "@/lib/catering-payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/drawer")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cash drawer — NairaPlate" },
      { name: "description", content: "Open and close a cashier shift and check the cash count." },
      { property: "og:title", content: "Cash drawer — NairaPlate" },
      { property: "og:description", content: "Open and close a cashier shift and check the cash count." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrawerScreen,
});

type Drawer = { id: string; opening_float_kobo: number; opened_at: string };
type Summary = {
  opening_float_kobo: number; expected_cash_kobo: number; closing_counted_kobo: number | null; discrepancy_kobo: number | null;
  cash_sales_kobo?: number; catering_cash_kobo?: number; debt_cash_kobo?: number;
};
const ROLES = new Set(["cashier", "owner", "supa_admin"]);

function DrawerScreen() {
  const { loading, session } = useStaffSession();
  const [open, setOpen] = useState<Drawer | null | undefined>(undefined);
  const [bizOpen, setBizOpen] = useState<ShiftRow | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [adjustments, setAdjustments] = useState<ShiftAdjustment[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forceFor, setForceFor] = useState<string | null>(null);
  const [forceCount, setForceCount] = useState("");
  const [forceReason, setForceReason] = useState("");
  const [adjFor, setAdjFor] = useState<string | null>(null);
  const [adjCount, setAdjCount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const owner = isOwnerRole(session?.role);

  const load = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("cash_drawers").select("id,opening_float_kobo,opened_at")
      .eq("business_id", session.businessId).eq("opened_by", session.userId).eq("status", "open")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    setOpen(data ? { ...data, opening_float_kobo: Number(data.opening_float_kobo) } : null);
    // One open shift per business: is anyone's shift open?
    const o = await supabase.from("cash_drawers").select(SHIFT_COLUMNS).eq("business_id", session.businessId).eq("status", "open").limit(1).maybeSingle();
    setBizOpen(o.data ? normaliseShifts([o.data])[0]! : null);
    if (isOwnerRole(session.role)) {
      const list = await supabase.from("cash_drawers").select(SHIFT_COLUMNS).eq("business_id", session.businessId).eq("status", "closed").order("closed_at", { ascending: false }).limit(20);
      const rows = normaliseShifts(list.data as unknown[]);
      setShifts(rows);
      if (rows.length) {
        const a = await supabase.from("cash_drawer_adjustments" as never).select("id,drawer_id,amount_kobo,reason,recorded_by_name,created_at").in("drawer_id", rows.map((r) => r.id)).order("created_at", { ascending: true });
        setAdjustments(normaliseAdjustments(a.data as unknown[]));
      } else setAdjustments([]);
    }
  }, [session]);
  useEffect(() => { load(); }, [load]);

  async function openShift() {
    if (!session || amount === "" || Number(amount) < 0) return setErr("Enter the float in naira.");
    setBusy(true); setErr(""); setMsg("");
    const { error } = await supabase.rpc("open_cash_drawer" as never, { p_float_kobo: nairaToKobo(amount) } as never);
    setBusy(false);
    if (error) return setErr("Could not open shift: " + error.message);
    setAmount(""); setSummary(null); load();
  }

  async function post(path: string, body: unknown) {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify(body) });
    return { ok: res.ok, body: await res.json() };
  }

  async function closeShift() {
    if (amount === "" || Number(amount) < 0) return setErr("Enter the cash you counted in naira.");
    setBusy(true); setErr(""); setMsg("");
    const r = await post("/api/public/cash-drawer-close", { closing_counted_kobo: nairaToKobo(amount) });
    setBusy(false);
    if (!r.ok) return setErr(r.body.error ?? "Could not close shift.");
    setSummary(r.body); setAmount(""); load();
  }

  async function forceClose(d: ShiftRow) {
    if (!reasonOk(forceReason)) return;
    setBusy(true); setErr(""); setMsg("");
    const r = await post("/api/public/cash-drawer-force-close", { drawer_id: d.id, reason: forceReason.trim(), closing_counted_kobo: forceCount === "" ? null : nairaToKobo(forceCount) });
    setBusy(false);
    if (!r.ok) return setErr(r.body.error ?? "Could not close the shift.");
    setMsg(`The shift was closed. Expected cash was ${formatNaira(r.body.expected_cash_kobo)}${r.body.closing_counted_kobo == null ? " (not counted)." : "."}`);
    setForceFor(null); setForceCount(""); setForceReason(""); load();
  }

  async function adjust(d: ShiftRow) {
    const delta = adjustmentDelta(nairaToKobo(adjCount), d, adjustments);
    if (delta == null || delta === 0 || !reasonOk(adjReason)) return;
    setBusy(true); setErr(""); setMsg("");
    const { error } = await supabase.rpc("adjust_closed_drawer" as never, { p_drawer_id: d.id, p_amount_kobo: delta, p_reason: adjReason.trim() } as never);
    setBusy(false);
    if (error) return setErr("Not saved: " + error.message);
    setMsg("The count was adjusted. The original count stays on record.");
    setAdjFor(null); setAdjCount(""); setAdjReason(""); load();
  }

  if (loading || open === undefined) return <p className="p-6">Loading…</p>;
  if (!session || !ROLES.has(session.role)) return <main className="p-6 space-y-3"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Back</Link></main>;

  const d = summary?.discrepancy_kobo ?? 0;
  const someoneElses = !open && bizOpen;
  return (
    <main className="mx-auto max-w-md p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Cash drawer</h1><Link className="underline" to="/app">Home</Link></div>

      {summary && (
        <section className="rounded-lg border p-4 space-y-1" aria-label="Shift summary">
          <h2 className="font-semibold">Shift closed</h2>
          <p>Opening float: {formatNaira(summary.opening_float_kobo)}</p>
          {summary.cash_sales_kobo != null && <p>Cash sales: {formatNaira(summary.cash_sales_kobo)}</p>}
          {!!summary.catering_cash_kobo && <p>Catering cash taken: {formatNaira(summary.catering_cash_kobo)}</p>}
          {!!summary.debt_cash_kobo && <p>Debt payments taken in cash: {formatNaira(summary.debt_cash_kobo)}</p>}
          <p>Expected cash: {formatNaira(summary.expected_cash_kobo)}</p>
          <p>Counted cash: {summary.closing_counted_kobo == null ? "not counted" : formatNaira(summary.closing_counted_kobo)}</p>
          <p className={d === 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
            {d === 0 ? "Balanced — ₦0.00" : d < 0 ? `Shortage: −${formatNaira(-d)}` : `Overage: +${formatNaira(d)}`}
          </p>
          {d !== 0 && <p className="text-sm text-muted-foreground">The owner has been alerted.</p>}
        </section>
      )}

      {open ? (
        <section className="space-y-2">
          <p>Shift open since {new Date(open.opened_at).toLocaleTimeString()} with a {formatNaira(open.opening_float_kobo)} float.</p>
          <Label htmlFor="amt">Cash counted in drawer (₦)</Label>
          <Input id="amt" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" disabled={busy} onClick={closeShift}>Close shift</Button>
        </section>
      ) : someoneElses ? (
        <section className="rounded-lg border p-4 space-y-2" data-testid="shift-open-elsewhere">
          <p>A shift is already open{bizOpen.opened_by_name ? `, opened by ${bizOpen.opened_by_name}` : ""} on {entryWhen(bizOpen.opened_at)}. It must be closed before another opens.</p>
          {canForceClose(bizOpen, session.role) && (forceFor === bizOpen.id ? (
            <div className="space-y-2 rounded-md bg-muted p-2">
              <p className="text-sm">Closing it works out expected cash up to now. The reason stays on record.</p>
              <Label htmlFor="force-count">Cash counted (₦, leave empty if not counted)</Label>
              <Input id="force-count" type="number" min={0} value={forceCount} onChange={(e) => setForceCount(e.target.value)} />
              <Label htmlFor="force-reason">Reason (at least 5 characters)</Label>
              <Input id="force-reason" value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={busy || !reasonOk(forceReason)} onClick={() => forceClose(bizOpen)}>Close this shift</Button>
                <Button size="sm" variant="ghost" onClick={() => { setForceFor(null); setForceCount(""); setForceReason(""); }}>Cancel</Button>
              </div>
            </div>
          ) : <Button size="sm" variant="outline" onClick={() => { setForceFor(bizOpen.id); setErr(""); setMsg(""); }}>Close this shift as owner</Button>)}
        </section>
      ) : (
        <section className="space-y-2">
          <Label htmlFor="amt">Opening float (₦)</Label>
          <Input id="amt" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button className="w-full" disabled={busy} onClick={openShift}>Open shift</Button>
        </section>
      )}
      {msg && <p className="text-primary">{msg}</p>}
      {err && <p className="text-destructive">{err}</p>}

      {owner && shifts.length > 0 && (
        <section className="space-y-2" aria-label="Closed shifts">
          <h2 className="font-semibold">Closed shifts</h2>
          <ul className="space-y-2" data-testid="closed-shifts">
            {shifts.map((s) => {
              const mine = adjustments.filter((a) => a.drawer_id === s.id);
              const count = adjustedCount(s, mine);
              const diff = adjustedDiscrepancy(s, mine);
              return (
                <li key={s.id} className="rounded-md border p-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{s.closed_at ? entryWhen(s.closed_at) : ""}{s.opened_by_name ? ` · ${s.opened_by_name}` : ""}</span>
                    <span className="text-xs rounded border px-1.5 py-0.5">{shiftLabel(s)}</span>
                  </div>
                  <div>Float {formatNaira(s.opening_float_kobo)}{s.cash_sales_kobo != null ? ` · cash sales ${formatNaira(s.cash_sales_kobo)}` : ""}{s.catering_cash_kobo ? ` · catering cash ${formatNaira(s.catering_cash_kobo)}` : ""}{s.debt_cash_kobo ? ` · debts in cash ${formatNaira(s.debt_cash_kobo)}` : ""}</div>
                  <div>Expected {s.expected_cash_kobo == null ? "—" : formatNaira(s.expected_cash_kobo)} · counted {s.closing_counted_kobo == null ? "not counted" : formatNaira(s.closing_counted_kobo)}
                    {s.discrepancy_kobo != null && <> · {s.discrepancy_kobo === 0 ? "balanced" : s.discrepancy_kobo < 0 ? `short ${formatNaira(-s.discrepancy_kobo)}` : `over ${formatNaira(s.discrepancy_kobo)}`}</>}</div>
                  {s.forced && s.close_reason && <div className="text-muted-foreground">Closed by {s.closed_by_name ?? "an owner"}: {s.close_reason}</div>}
                  {mine.map((a) => (
                    <div key={a.id} className="text-muted-foreground">Adjusted {a.amount_kobo > 0 ? "+" : "−"}{formatNaira(Math.abs(a.amount_kobo))} by {a.recorded_by_name ?? "owner"} on {entryWhen(a.created_at)}: {a.reason}</div>
                  ))}
                  {mine.length > 0 && count != null && diff != null && (
                    <div className="font-semibold">After adjustments: counted {formatNaira(count)} · {diff === 0 ? "balanced" : diff < 0 ? `short ${formatNaira(-diff)}` : `over ${formatNaira(diff)}`}</div>
                  )}
                  {canAdjust(s, session.role) && (adjFor === s.id ? (
                    <div className="space-y-2 rounded-md bg-muted p-2">
                      <p className="text-xs">The original count stays on record. Type what the count should have been.</p>
                      <Label htmlFor={`adj-c-${s.id}`}>Correct count (₦)</Label>
                      <Input id={`adj-c-${s.id}`} type="number" min={0} value={adjCount} onChange={(e) => setAdjCount(e.target.value)} />
                      <Label htmlFor={`adj-r-${s.id}`}>Reason (at least 5 characters)</Label>
                      <Input id={`adj-r-${s.id}`} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                      {adjCount !== "" && adjustmentDelta(nairaToKobo(adjCount), s, mine) === 0 && <p className="text-xs">That is the same as the current count.</p>}
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy || !reasonOk(adjReason) || !adjustmentDelta(nairaToKobo(adjCount), s, mine)} onClick={() => adjust(s)}>Save adjustment</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAdjFor(null); setAdjCount(""); setAdjReason(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : <Button size="sm" variant="outline" onClick={() => { setAdjFor(s.id); setAdjCount(""); setAdjReason(""); setErr(""); setMsg(""); }}>Correct the count</Button>)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
