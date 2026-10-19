// Selar payments waiting for approval. Platform admin only (the server checks that again on every call).
// Approving records the payment through the normal "record payment" path (which checks the amount against the price list and emails the owner),
// then closes the Selar entry. A payment with no matching kitchen can be matched by typing the business code.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lagosDateKey } from "@/lib/lagos-time";
import { PLAN_NAME } from "@/lib/platform-settings";
import { TERM_LABEL, planText, type PlanTerm } from "@/lib/plan-choice";
import type { OperatingMode } from "@/lib/features";

type Row = {
  id: string; created_at: string; order_ref: string; status: "awaiting_approval" | "unmatched" | "approved" | "rejected";
  matched_business_id: string | null; business_name: string | null; business_status: string | null; operating_mode: OperatingMode | null;
  paid_mode: OperatingMode | null; paid_term: PlanTerm | null; chosen_mode: OperatingMode | null; chosen_term: PlanTerm | null; differences: string[];
  buyer_name: string | null; buyer_email: string | null; product_name: string | null; amount_kobo: number | null;
  plan_guess: "monthly" | "quarterly" | "yearly" | null; setup_guess: boolean; paid_at: string | null;
  raw: unknown; note: string | null; decided_at: string | null; decision_reason: string | null;
};

async function callApi(body: unknown) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch("/api/public/platform-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const naira = (kobo: number | null) => (kobo === null ? "not read" : "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

export function SelarPayments({ onCount }: { onCount?: (n: number) => void }) {
  const [view, setView] = useState<"open" | "done">("open");
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const { status, data } = await callApi({ action: "selar_list", view });
    if (status !== 200) { setRows([]); return setErr(String(data["error"] ?? "Could not load Selar payments.")); }
    const list = (data["payments"] ?? []) as Row[];
    setRows(list);
    if (view === "open") onCount?.(list.length);
  }, [view, onCount]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={view === "open" ? "default" : "outline"} onClick={() => setView("open")}>Waiting</Button>
        <Button variant={view === "done" ? "default" : "outline"} onClick={() => setView("done")}>Decided</Button>
        <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        These payments came from Selar. Nothing here has switched on any kitchen. Approving records the payment (the amount is checked against the price list) and emails the owner.
      </p>
      {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</p>}
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{err}</p>}
      {rows.length === 0 && !err && <p className="text-sm">{view === "open" ? "Nothing waiting." : "Nothing decided yet."}</p>}
      {rows.map((r) => (
        <PaymentCard key={r.id} row={r} busy={busy} setBusy={setBusy} done={(t) => { setMsg(t); void load(); }} fail={(t) => setErr(t)} />
      ))}
    </section>
  );
}

function PaymentCard({ row, busy, setBusy, done, fail }: { row: Row; busy: boolean; setBusy: (b: boolean) => void; done: (t: string) => void; fail: (t: string) => void }) {
  const open = row.status === "awaiting_approval" || row.status === "unmatched";
  const [plan, setPlan] = useState<PlanTerm>(row.plan_guess ?? "monthly");
  const [diff, setDiff] = useState("");
  const [switchOk, setSwitchOk] = useState(false);
  const needsSwitch = !!row.paid_mode && !!row.operating_mode && row.paid_mode !== row.operating_mode;
  const suspended = row.business_status === "suspended";
  const pending = row.business_status === "pending";
  const [code, setCode] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const today = lagosDateKey(new Date());
  const paidOn = /^\d{4}-\d{2}-\d{2}/.test(row.paid_at ?? "") && (row.paid_at as string).slice(0, 10) <= today ? (row.paid_at as string).slice(0, 10) : today;
  const kobo = row.amount_kobo ?? 0;

  async function run(label: string, steps: () => Promise<string | null>) {
    setBusy(true);
    const problem = await steps();
    setBusy(false);
    if (problem) fail(problem); else done(label);
  }

  const approveSetup = () => run("Setup fee recorded as paid.", async () => {
    const ap = await callApi({ action: "selar_approve", id: row.id });
    return ap.status === 200 ? null : String(ap.data["error"] ?? "Could not approve.");
  });
  const approve = (reactivate: boolean) => run(`Payment recorded and approved. The owner has been emailed.${reactivate ? " The kitchen was reactivated." : ""}`, async () => {
    // 1. If the payment is for another plan type than the kitchen's, switch the kitchen first (the admin confirmed it), so the price check uses the paid plan.
    if (needsSwitch) {
      const sw = await callApi({ action: "set_operating_mode", business_id: row.matched_business_id, mode: row.paid_mode });
      if (sw.status !== 200) return String(sw.data["error"] ?? "Could not switch the kitchen's plan type.");
    }
    // 2. Record the payment: this checks the amount and extends access.
    const rec = await callApi({
      action: "record_payment", business_id: row.matched_business_id, plan, amount_kobo: kobo, payment_reference: row.order_ref, paid_on: paidOn,
      includes_setup: false, ...(diff.trim() ? { difference_reason: diff.trim() } : {}),
    });
    // 409 means this reference was already recorded (for example a first click that did not finish): carry on and close it.
    if (rec.status !== 200 && rec.status !== 409) return String(rec.data["error"] ?? "Could not record the payment.");
    // 3. Reactivate a suspended kitchen only when the admin chose to.
    if (reactivate) {
      const re = await callApi({ action: "set_status", business_id: row.matched_business_id, status: "approved" });
      if (re.status !== 200) return "Payment recorded, but the kitchen could not be reactivated: " + String(re.data["error"] ?? "");
    }
    // 4. Close the Selar entry.
    const ap = await callApi({ action: "selar_approve", id: row.id });
    return ap.status === 200 ? null : String(ap.data["error"] ?? "Could not approve.");
  });
  // A store that registered through the payment page: make sure it can never start a trial, approve it, set the plan it paid for,
  // record the payment, then close the Selar entry. Each step stops on the first failure and says which one.
  const approvePending = () => run("Store approved and payment recorded. The owner has been emailed.", async () => {
    const pre = await callApi({ action: "prepare_paid_store", business_id: row.matched_business_id });
    if (pre.status !== 200) return "Nothing was changed. The store could not be prepared for approval: " + String(pre.data["error"] ?? "");
    const st = await callApi({ action: "set_status", business_id: row.matched_business_id, status: "approved" });
    if (st.status !== 200) return "Could not approve the store: " + String(st.data["error"] ?? "");
    if (row.paid_mode && row.operating_mode !== row.paid_mode) {
      const sw = await callApi({ action: "set_operating_mode", business_id: row.matched_business_id, mode: row.paid_mode });
      if (sw.status !== 200) return "Store approved, but its plan type could not be set: " + String(sw.data["error"] ?? "");
    }
    const rec = await callApi({
      action: "record_payment", business_id: row.matched_business_id, plan, amount_kobo: kobo, payment_reference: row.order_ref, paid_on: paidOn,
      includes_setup: false, ...(diff.trim() ? { difference_reason: diff.trim() } : {}),
    });
    if (rec.status !== 200 && rec.status !== 409) return "Store approved, but the payment could not be recorded: " + String(rec.data["error"] ?? "");
    const ap = await callApi({ action: "selar_approve", id: row.id });
    return ap.status === 200 ? null : String(ap.data["error"] ?? "Could not approve.");
  });
  const assign = () => run("Matched to that business.", async () => {
    const r = await callApi({ action: "selar_assign", id: row.id, business_id: code.trim().toLowerCase() });
    return r.status === 200 ? null : String(r.data["error"] ?? "Could not match.");
  });
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">{row.business_name ? `${row.business_name} (${row.matched_business_id})` : "No kitchen matched"}</div>
        <div className="text-muted-foreground">{when(row.created_at)} · {row.status.replace("_", " ")}</div>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <div>Buyer: {row.buyer_name ?? "not read"} {row.buyer_email ? `(${row.buyer_email})` : ""}</div>
        <div>Product: {row.product_name ?? "not read"} ({row.setup_guess ? "setup fee" : "subscription"})</div>
        <div>Amount paid: <strong>{naira(row.amount_kobo)}</strong></div>
        <div>Selar order: {row.order_ref}</div>
        {row.paid_at && <div>Date: {row.paid_at}</div>}
        {row.operating_mode && <div>Kitchen plan type: {PLAN_NAME[row.operating_mode as keyof typeof PLAN_NAME] ?? row.operating_mode}</div>}
      </div>
      {row.note && <p className="rounded bg-amber-50 p-2 text-amber-900">{row.note}</p>}
      <button type="button" className="text-xs underline" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "Hide" : "Show"} the whole message from Selar</button>
      {showRaw && <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(row.raw, null, 2)}</pre>}

      {open && row.status === "unmatched" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" placeholder="Business code to match" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button disabled={busy || code.trim().length < 1} onClick={assign}>Match to this business</Button>
        </div>
      )}
      {open && row.status === "awaiting_approval" && row.setup_guess && (
        <div className="space-y-2">
          <p>Setup fee. Approving records it as paid. Access does not change.</p>
          <Button disabled={busy || !row.matched_business_id} onClick={approveSetup}>Approve setup fee</Button>
        </div>
      )}
      {open && row.status === "awaiting_approval" && !row.setup_guess && (
        <div className="space-y-2">
          <div className="space-y-1">
            <div>Paid for: <strong>{row.paid_mode && row.paid_term ? planText({ mode: row.paid_mode, term: row.paid_term }) : "no plan on the price list"}</strong></div>
            <div>Chosen on the plan page: {row.chosen_mode && row.chosen_term ? planText({ mode: row.chosen_mode, term: row.chosen_term }) : "nothing recorded"}</div>
          </div>
          {row.differences.map((d) => <p key={d} className="rounded bg-amber-50 p-2 text-amber-900">{d}</p>)}
          {!row.paid_term && (
            <label className="flex items-center gap-1">Term
              <select className="rounded border border-border bg-background px-2 py-1" value={plan} onChange={(e) => setPlan(e.target.value as PlanTerm)}>
                {(Object.keys(TERM_LABEL) as PlanTerm[]).map((k) => <option key={k} value={k}>{TERM_LABEL[k]}</option>)}
              </select>
            </label>
          )}
          {needsSwitch && row.paid_mode && (
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={switchOk} onChange={(e) => setSwitchOk(e.target.checked)} />
              Switch this kitchen to {PLAN_NAME[row.paid_mode]}
            </label>
          )}
          {suspended && <p className="rounded bg-amber-50 p-2 text-amber-900">This kitchen is suspended. Do you want to reactivate it with this payment?</p>}
          {pending && <p className="rounded bg-amber-50 p-2 text-amber-900">This store is still waiting for approval. It paid first, so there is no trial.</p>}
          <Input placeholder="Reason, only if the amount differs from the price list" value={diff} onChange={(e) => setDiff(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {pending ? (
              <Button disabled={busy || !(kobo > 0) || !row.matched_business_id || !row.paid_mode} onClick={approvePending}>Approve the store and record the payment</Button>
            ) : suspended ? (
              <>
                <Button disabled={busy || !(kobo > 0) || !row.matched_business_id || (needsSwitch && !switchOk)} onClick={() => approve(true)}>Approve and reactivate</Button>
                <Button variant="outline" disabled={busy || !(kobo > 0) || !row.matched_business_id || (needsSwitch && !switchOk)} onClick={() => approve(false)}>Approve, keep suspended</Button>
              </>
            ) : (
              <Button disabled={busy || !(kobo > 0) || !row.matched_business_id || (needsSwitch && !switchOk)} onClick={() => approve(false)}>Record payment and approve</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
