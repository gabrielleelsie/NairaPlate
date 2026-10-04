import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/external-supabase";
import { useStaffSession } from "@/lib/staff-session";
import { formatNaira, nairaToKobo } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAY_CHOICE_LABEL, payChoicesFor, type PayChoice } from "@/lib/payment-ui";
import type { PaymentMode } from "@/lib/payments";
import { TransferWaiting, type WaitingRequest } from "@/components/TransferWaiting";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useConnectivity, watTime } from "@/lib/connectivity";
import { deleteDraft, draftKey, getTillLabel, loadDraft, logOutage, nextPaperSequence, saveDraft, setTillLabel } from "@/lib/offline-store";
import { expiredAtMs, isDraftEmpty, isDraftExpired, isExpiredPurgeDue, newClientSaleId, paperReference, sanitizeDraft, type PosDraft } from "@/lib/pos-draft";
import { printPaperForm } from "@/lib/paper-fallback";
import { lagosDateKey } from "@/lib/lagos-time";

export const Route = createFileRoute("/pos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Till — NairaPlate" },
      { name: "description", content: "Ring up orders with cash, transfer or split payment." },
      { property: "og:title", content: "Till — NairaPlate" },
      { property: "og:description", content: "Ring up orders with cash, transfer or split payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosScreen,
});

type Recipe = { id: string; name: string; selling_price_kobo: number };
type Line = { recipe_id: string; quantity: number };
type Pay = PayChoice;
const PAY_LABEL = PAY_CHOICE_LABEL;
const POS_ROLES = new Set(["cashier", "owner", "supa_admin"]);
const TIERS = ["Standard", "Wholesale", "Event"];
const MENU_STALE_MS = 2 * 60 * 60 * 1000;

/** A failure where we cannot know whether the database saved the sale (the request or reply was lost). */
function isUncertain(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code && error.code.length > 0) return false; // the database answered with a clear refusal
  return /fetch|network|timeout|abort|load failed/i.test(error.message ?? "") || !error.code;
}

function PosScreen() {
  const { loading, session } = useStaffSession();
  const conn = useConnectivity(true);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [menuSyncedAt, setMenuSyncedAt] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const [channel, setChannel] = useState("Walk-in");
  const [aggName, setAggName] = useState("");
  const [tier, setTier] = useState("Standard");
  const [pay, setPay] = useState<Pay>("cash");
  const [cashN, setCashN] = useState("");
  const [trN, setTrN] = useState("");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PaymentMode | null>(null);
  const [waiting, setWaiting] = useState<WaitingRequest[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Offline Phase 0
  const [clientSaleId, setClientSaleId] = useState(() => newClientSaleId());
  const [draftState, setDraftState] = useState<PosDraft["state"]>("editing");
  const [draftReady, setDraftReady] = useState(false);
  const [priorDraft, setPriorDraft] = useState<PosDraft | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [draftCreatedAt, setDraftCreatedAt] = useState(() => new Date().toISOString());
  const [expiredDraft, setExpiredDraft] = useState<PosDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tillLabel, setTillLabelState] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [shiftOpenedAt, setShiftOpenedAt] = useState<string | null>(null);
  const sending = useRef(false);

  const key = session ? draftKey(session.businessId, session.userId) : null;

  const loadMenu = async () => {
    await supabase.rpc("refresh_dish_prices" as never); // show a scheduled price once it has started; failure is harmless
    const { data, error } = await supabase.from("recipes").select("id,name,selling_price_kobo").eq("is_current", true).order("name");
    if (error) { conn.reportRequestFailure(); return setMsg({ ok: false, text: "Could not load menu." }); }
    setRecipes((data ?? []).map((r) => ({ ...r, selling_price_kobo: Number(r.selling_price_kobo) })));
    setMenuSyncedAt(new Date().toISOString());
  };
  useEffect(() => { void loadMenu(); setTillLabelState(getTillLabel()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const menuStale = !menuSyncedAt || Date.now() - Date.parse(menuSyncedAt) > MENU_STALE_MS;
  // Online with an old menu: refresh it. The database still sets every price on save.
  useEffect(() => { if (conn.isOnline && menuStale && menuSyncedAt) void loadMenu(); }, [conn.isOnline, conn.lastSuccessfulHeartbeatAtUtc]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadWaiting = async () => {
    const { data } = await supabase.from("payment_requests").select("id,order_id,reference,status,amount_kobo,paid_amount_kobo,created_at,account_number,bank_name,account_name")
      .in("status", ["waiting", "short"]).order("created_at", { ascending: false });
    setWaiting((data ?? []).map((d) => ({ ...(d as WaitingRequest), amount_kobo: Number(d.amount_kobo), paid_amount_kobo: d.paid_amount_kobo === null ? null : Number(d.paid_amount_kobo) })));
  };
  useEffect(() => {
    supabase.from("business_payment_settings").select("mode").maybeSingle().then(({ data }) => setMode((data?.mode as PaymentMode | undefined) ?? "manual"));
    void loadWaiting();
  }, []);
  useEffect(() => { if (mode && !payChoicesFor(mode).includes(pay)) setPay("cash"); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Details for the paper form (best effort; blank lines if unavailable).
  useEffect(() => {
    if (!session) return;
    supabase.from("businesses").select("name").eq("id", session.businessId).maybeSingle().then(({ data }) => setBusinessName(data?.name ?? session.businessId));
    supabase.from("cash_drawers").select("opened_at").eq("business_id", session.businessId).eq("status", "open").limit(1).maybeSingle()
      .then(({ data }) => setShiftOpenedAt(data?.opened_at ?? null));
  }, [session?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyDraft = (d: PosDraft) => {
    setLines(d.lines); setChannel(d.channel); setAggName(d.aggName); setTier(d.tier); setPay(d.pay);
    setCashN(d.cashN); setTrN(d.trN); setCustName(d.custName ?? ""); setCustPhone(d.custPhone ?? "");
    setClientSaleId(d.clientSaleId); setDraftState(d.state === "uncertain" ? "uncertain" : "editing");
    setDraftCreatedAt(d.createdAtUtc ?? d.updatedAtUtc);
  };

  // On opening: offer any unfinished draft from before. An unconfirmed sale is restored straight away and must be resolved.
  useEffect(() => {
    if (!key) return;
    void loadDraft(key).then(async (d) => {
      // Expired, never-sent drafts are kept visible but can never be charged. After a 7-day grace they are
      // purged to a tombstone with no items or customer details. Uncertain drafts are never expired here:
      // they must be checked with the server first.
      const now = Date.now();
      if (d && d.state !== "uncertain" && (d.state === "expired_pending_review" || (isDraftExpired(d, now) && !isDraftEmpty(d)))) {
        if (isExpiredPurgeDue(d, now)) {
          await logOutage({ kind: "draft_auto_purged", atUtc: new Date().toISOString(), clientSaleId: d.clientSaleId,
            createdAtUtc: d.createdAtUtc ?? null, expiredAtUtc: new Date(expiredAtMs(d)).toISOString() });
          await deleteDraft(key);
        } else {
          const ex: PosDraft = { ...d, state: "expired_pending_review" };
          if (d.state !== "expired_pending_review") await saveDraft(ex);
          setExpiredDraft(ex);
        }
        setDraftReady(true);
        return;
      }
      if (d && isDraftExpired(d, now) && isDraftEmpty(d)) { await deleteDraft(key); d = null; }
      if (d && d.state === "uncertain") applyDraft(d);
      else if (d && !isDraftEmpty(d)) setPriorDraft(d);
      setDraftReady(true);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentDraft = (): PosDraft | null => key ? sanitizeDraft({
    key, clientSaleId, lines, channel, aggName, tier, pay, cashN, trN, custName, custPhone, state: draftState, updatedAtUtc: new Date().toISOString(), createdAtUtc: draftCreatedAt,
  }) : null;

  // Keep the draft on the device as it changes. Never cleared just because the connection came back.
  useEffect(() => {
    if (!draftReady || priorDraft || expiredDraft) return;
    const d = currentDraft();
    if (!d) return;
    if (isDraftEmpty(d)) void deleteDraft(d.key); else void saveDraft(d);
  }, [draftReady, priorDraft, lines, channel, aggName, tier, pay, cashN, trN, custName, custPhone, draftState, clientSaleId, expiredDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetSale = async () => {
    setLines([]); setCashN(""); setTrN(""); setCustName(""); setCustPhone("");
    setDraftState("editing"); setClientSaleId(newClientSaleId()); setDraftCreatedAt(new Date().toISOString());
    if (key) await deleteDraft(key);
  };

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.recipe_id)?.selling_price_kobo ?? 0) * l.quantity, 0);
  const cashK = pay === "split" ? nairaToKobo(cashN) : pay === "cash" ? subtotal : 0;
  const trK = pay === "split" ? nairaToKobo(trN) : pay === "transfer" ? subtotal : 0;
  const splitSum = cashK + trK;
  const splitOk = pay !== "split" || (cashK > 0 && trK > 0 && splitSum === subtotal);
  const finalChannel = channel === "Aggregator" ? aggName.trim() : channel;
  const creditOk = pay !== "credit" || (custName.trim().length > 0 && custPhone.trim().length > 0);
  const locked = draftState === "uncertain";
  const canSubmit = lines.length > 0 && subtotal > 0 && splitOk && creditOk && finalChannel.length > 0 && !busy && !locked && conn.isOnline && !priorDraft && !expiredDraft;

  function addLine() {
    const q = Math.floor(Number(qty));
    if (!pick || !(q > 0)) return;
    setLines((ls) => {
      const ex = ls.find((l) => l.recipe_id === pick);
      return ex ? ls.map((l) => (l === ex ? { ...l, quantity: l.quantity + q } : l)) : [...ls, { recipe_id: pick, quantity: q }];
    });
    setQty("1");
  }

  /** Marks the sale as sent-but-unconfirmed on the device BEFORE sending, so a crash mid-send cannot lead to a second sale. */
  async function markSending() {
    setDraftState("uncertain");
    const d = currentDraft();
    if (d) await saveDraft({ ...d, state: "uncertain" });
  }

  async function afterError(error: { message?: string; code?: string }) {
    if (isUncertain(error)) {
      conn.reportRequestFailure();
      setMsg({ ok: false, text: "We could not confirm whether this sale saved." });
      return; // stays "uncertain" until checked
    }
    setDraftState("editing"); // the database clearly refused; nothing was saved
    setMsg({ ok: false, text: "Order not saved: " + (error.message ?? "unknown error") });
  }

  async function submit() {
    if (!session || sending.current || !conn.isOnline) return;
    if (pay !== "auto_transfer" && pay !== "credit" && (cashK + trK !== subtotal || (pay === "split" && (cashK <= 0 || trK <= 0)))) {
      return setMsg({ ok: false, text: "Cash and transfer must add up exactly to the total." });
    }
    sending.current = true; setBusy(true); setMsg(null);
    await markSending();
    const items = lines.map((l) => ({ recipe_id: l.recipe_id, quantity: l.quantity }));
    try {
      // Automatic transfer: the order waits for the bank. Only the bank's message can mark it paid.
      if (pay === "auto_transfer") {
        const { data, error } = await supabase.rpc("create_transfer_order_once" as never, {
          p_client_sale_id: clientSaleId, p_channel: finalChannel, p_price_tier: tier, p_items: items,
        } as never);
        if (error) return await afterError(error);
        const created = data as { request_id: string; amount_kobo: number };
        await resetSale();
        const { data: sess } = await supabase.auth.getSession();
        const res = await fetch("/api/public/payment-start", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
          body: JSON.stringify({ request_id: created.request_id }),
        }).catch(() => null);
        if (!res || !res.ok) {
          const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
          setMsg({ ok: false, text: `Order saved and waiting, but no account number yet: ${j.error ?? "could not reach the bank service"}. Cancel it below or try again.` });
        }
        await loadWaiting();
        return;
      }
      // Credit sale: order + items + customer_credits row saved together in one database step.
      if (pay === "credit") {
        const name = custName.trim();
        const { data, error } = await supabase.rpc("create_credit_order_once" as never, {
          p_client_sale_id: clientSaleId, p_channel: finalChannel, p_price_tier: tier, p_customer_name: name, p_phone: custPhone.trim(), p_items: items,
        } as never);
        if (error) return await afterError(error);
        const total = Number((data as { total_kobo: number }).total_kobo);
        await resetSale();
        setMsg({ ok: true, text: `Order saved — ${name} owes ${formatNaira(total)}.` });
        return;
      }
      // The database reads every price from the menu and works out the total itself.
      const { data, error } = await supabase.rpc("create_cash_order_once" as never, {
        p_client_sale_id: clientSaleId, p_channel: finalChannel, p_price_tier: tier, p_payment_method: pay, p_cash_kobo: cashK, p_transfer_kobo: trK, p_items: items,
      } as never);
      if (error) return await afterError(error);
      const saved = data as { total_kobo: number };
      await resetSale();
      setMsg({ ok: true, text: `Order saved — ${formatNaira(Number(saved.total_kobo))} (${pay}).` });
    } catch (e) {
      await afterError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      sending.current = false; setBusy(false);
    }
  }

  /** "Check again": asks the database whether a sale with this reference was saved. */
  async function checkAgain() {
    setChecking(true);
    const ok = await conn.checkNow();
    if (!ok) { setChecking(false); return setMsg({ ok: false, text: "Still no connection. Keep this order as it is, or use the paper form." }); }
    const { data, error } = await supabase.rpc("find_sale_by_client_id" as never, { p_client_sale_id: clientSaleId } as never);
    setChecking(false);
    if (error) return setMsg({ ok: false, text: "Could not check yet: " + error.message });
    const r = data as { found: boolean; total_kobo?: number; status?: string };
    if (r.found) {
      await resetSale();
      await loadWaiting();
      setMsg({ ok: true, text: `Sale found — it was saved (${formatNaira(Number(r.total_kobo ?? 0))}). Nothing was charged twice.` });
    } else {
      setDraftState("editing");
      setMsg({ ok: false, text: "Sale not found — it was not saved. You can charge it again." });
    }
  }

  function printPaper(expired?: { draft: PosDraft; ownerReview: boolean }) {
    if (!session) return;
    const label = tillLabel.trim();
    if (label) setTillLabel(label);
    const dateKey = lagosDateKey(new Date());
    const ref = paperReference(session.businessId, dateKey, label, nextPaperSequence(session.businessId, dateKey));
    const opened = printPaperForm({
      reference: ref, businessName, tillLabel: label, cashierName: session.name,
      shiftOpenedWat: shiftOpenedAt ? watTime(shiftOpenedAt) : null, printedAtWat: watTime(new Date().toISOString()),
      draftLines: (expired ? expired.draft.lines : lines).map((l) => ({ name: byId.get(l.recipe_id)?.name ?? "Dish", quantity: l.quantity, priceKobo: byId.get(l.recipe_id)?.selling_price_kobo ?? 0 })),
      menuStale: menuStale || !conn.isOnline || !!expired,
      ...(expired ? { expired: { ownerReview: expired.ownerReview, lastEditedWat: watTime(expired.draft.updatedAtUtc),
        createdWat: expired.draft.createdAtUtc ? watTime(expired.draft.createdAtUtc) : null } } : {}),
    });
    if (!opened) setMsg({ ok: false, text: "The print window was blocked. Allow pop-ups for NairaPlate and try again." });
  }

  async function discardPrior() {
    if (!priorDraft || !key || discardReason.trim().length < 3) return;
    await logOutage({ kind: "draft_discarded", atUtc: new Date().toISOString(), reason: discardReason.trim(), clientSaleId: priorDraft.clientSaleId });
    await deleteDraft(key);
    setPriorDraft(null); setDiscardReason("");
  }

  async function askOwnerReview() {
    if (!expiredDraft || !key) return;
    const atUtc = new Date().toISOString();
    const d: PosDraft = { ...expiredDraft, reviewRequestedAtUtc: atUtc };
    await saveDraft(d);
    await logOutage({ kind: "draft_review_requested", atUtc, clientSaleId: d.clientSaleId });
    setExpiredDraft(d);
    printPaper({ draft: d, ownerReview: true });
  }

  async function discardExpired() {
    if (!expiredDraft || !key || discardReason.trim().length < 3) return;
    await logOutage({ kind: "draft_discarded", atUtc: new Date().toISOString(), reason: discardReason.trim(), clientSaleId: expiredDraft.clientSaleId, expired: true });
    await deleteDraft(key); // removes items and any credit customer name/phone
    setExpiredDraft(null); setDiscardReason(""); setConfirmDiscard(false);
    setMsg({ ok: true, text: "Expired draft discarded. Nothing had been saved from it." });
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (!session || !POS_ROLES.has(session.role)) return (
    <main className="p-6 space-y-3"><p>Cashiers and owners only.</p><Link className="underline" to="/app">Back</Link></main>
  );

  const sel = "w-full h-10 rounded-md border border-input bg-background px-3";
  return (
    <main className="mx-auto max-w-xl p-4 space-y-5">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Till</h1><div className="flex gap-3"><Link className="underline" to="/late-entries">Enter paper sale</Link><Link className="underline" to="/app">Home</Link></div></div>

      <OfflineBanner status={conn.status} outageStartedAtUtc={conn.outageStartedAtUtc} menuSyncedAtUtc={menuSyncedAt}
        menuStale={menuStale} onPrintPaper={() => printPaper()} />

      {expiredDraft && (() => {
        const ex = expiredDraft;
        const total = ex.lines.reduce((s, l) => s + (byId.get(l.recipe_id)?.selling_price_kobo ?? 0) * l.quantity, 0);
        const payLabel: Record<string, string> = { cash: "Cash", transfer: "Transfer", split: "Split", credit: "Credit", auto_transfer: "Automatic transfer" };
        return (
        <section className="rounded-md border-2 border-destructive p-3 space-y-2" role="alert">
          <p className="font-semibold">Expired draft — not saved</p>
          <p className="text-sm">This sale draft is more than 24 hours old and was never confirmed by NairaPlate. It cannot be submitted as a normal sale.</p>
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Created</dt><dd>{ex.createdAtUtc ? watTime(ex.createdAtUtc) : "Unknown"}</dd>
            <dt>Last edited</dt><dd>{watTime(ex.updatedAtUtc)}</dd>
            <dt>Payment chosen</dt><dd>{payLabel[ex.pay] ?? ex.pay}</dd>
            <dt>Total</dt><dd>{formatNaira(total)} <span className="text-muted-foreground">(unconfirmed, at today's menu prices)</span></dd>
            <dt>Customer details</dt><dd>{ex.pay === "credit" && (ex.custName || ex.custPhone) ? `Yes: ${ex.custName ?? ""} ${ex.custPhone ?? ""}` : "None"}</dd>
            {ex.reviewRequestedAtUtc && (<><dt>Owner review</dt><dd>Asked {watTime(ex.reviewRequestedAtUtc)}</dd></>)}
          </dl>
          <ul className="text-sm list-disc pl-5">
            {ex.lines.map((l) => <li key={l.recipe_id}>{l.quantity} × {byId.get(l.recipe_id)?.name ?? "Dish no longer on menu"}</li>)}
          </ul>
          <p className="text-sm font-medium">No order, payment, stock movement or cash-drawer entry was created from this draft.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => printPaper({ draft: ex, ownerReview: false })}>Print paper fallback</Button>
            <Button size="sm" variant="outline" onClick={askOwnerReview}>Ask owner to review</Button>
          </div>
          <div className="flex gap-2">
            <Input aria-label="Reason for discarding" placeholder="Reason for discarding" value={discardReason} onChange={(e) => { setDiscardReason(e.target.value); setConfirmDiscard(false); }} />
            {!confirmDiscard
              ? <Button size="sm" variant="destructive" disabled={discardReason.trim().length < 3} onClick={() => setConfirmDiscard(true)}>Discard draft</Button>
              : <Button size="sm" variant="destructive" onClick={discardExpired}>Confirm discard</Button>}
          </div>
          <p className="text-xs text-muted-foreground">If nothing is done, this draft and any customer details are removed from this device 7 days after it expired.</p>
        </section>);
      })()}

      {priorDraft && (
        <section className="rounded-md border-2 border-accent p-3 space-y-2">
          <p className="font-semibold">Unfinished order from {watTime(priorDraft.updatedAtUtc)}</p>
          <p className="text-sm">{priorDraft.lines.reduce((s, l) => s + l.quantity, 0)} item(s). It has not been saved to NairaPlate.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { applyDraft(priorDraft); setPriorDraft(null); }}>Resume</Button>
            <Button size="sm" variant="outline" onClick={() => { applyDraft(priorDraft); setPriorDraft(null); setTimeout(() => printPaper(), 0); }}>Resume and print paper form</Button>
          </div>
          <div className="flex gap-2">
            <Input aria-label="Reason for discarding" placeholder="Reason for discarding" value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} />
            <Button size="sm" variant="destructive" disabled={discardReason.trim().length < 3} onClick={discardPrior}>Discard</Button>
          </div>
        </section>
      )}

      {locked && (
        <section className="rounded-md border-2 border-destructive p-3 space-y-2" role="alert">
          <p className="font-semibold">We could not confirm whether this sale saved.</p>
          <p className="text-sm">Do not create another sale yet. Reference: <span className="font-mono">{clientSaleId.slice(0, 8)}</span></p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={checking} onClick={checkAgain}>{checking ? "Checking sale status…" : "Check again"}</Button>
            <Button size="sm" variant="outline" onClick={() => printPaper()}>Use paper fallback</Button>
          </div>
        </section>
      )}

      {waiting.map((w) => (
        <TransferWaiting key={w.id} initial={w} onFinished={(text, ok) => { setMsg({ ok, text }); void loadWaiting(); }} />
      ))}

      <fieldset disabled={locked || !!priorDraft || !!expiredDraft} className="space-y-5 disabled:opacity-60">
      <section className="space-y-2">
        <Label>Add item</Label>
        <div className="flex gap-2">
          <select aria-label="Item" className={sel} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a dish…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name} — {formatNaira(r.selling_price_kobo)}</option>)}
          </select>
          <Input aria-label="Quantity" className="w-20" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button onClick={addLine}>Add</Button>
        </div>
        {lines.map((l) => { const r = byId.get(l.recipe_id); return (
          <div key={l.recipe_id} className="flex justify-between text-sm border-b py-1">
            <span>{l.quantity} × {r?.name ?? "Dish no longer on menu"}</span>
            <span className="flex gap-3">{formatNaira((r?.selling_price_kobo ?? 0) * l.quantity)}
              <button className="text-destructive" onClick={() => setLines((ls) => ls.filter((x) => x !== l))}>Remove</button></span>
          </div>); })}
        <p className="text-lg font-semibold">Subtotal: {formatNaira(subtotal)}</p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Channel</Label>
          <select aria-label="Channel" className={sel} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option>Walk-in</option><option>Delivery</option><option>Aggregator</option>
          </select>
          {channel === "Aggregator" && <Input aria-label="Aggregator name" placeholder="e.g. Chowdeck, Glovo" value={aggName} onChange={(e) => setAggName(e.target.value)} />}
        </div>
        <div className="space-y-1"><Label>Price tier</Label>
          <Input aria-label="Price tier" list="tiers" value={tier} onChange={(e) => setTier(e.target.value)} />
          <datalist id="tiers">{TIERS.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </section>

      <section className="space-y-2">
        <Label>Payment</Label>
        <div className="flex flex-wrap gap-4">
          {payChoicesFor(mode).map((p) => (
            <label key={p} className="flex items-center gap-1">
              <input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} /> {PAY_LABEL[p]}
            </label>))}
        </div>
        {pay === "credit" && (
          <div className="flex gap-2">
            <Input aria-label="Customer name" placeholder="Customer name" value={custName} onChange={(e) => setCustName(e.target.value)} />
            <Input aria-label="Customer phone" placeholder="Phone" type="tel" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
          </div>)}
        {pay === "split" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input aria-label="Cash amount" placeholder="Cash ₦" type="number" value={cashN} onChange={(e) => setCashN(e.target.value)} />
              <Input aria-label="Transfer amount" placeholder="Transfer ₦" type="number" value={trN} onChange={(e) => setTrN(e.target.value)} />
            </div>
            <p className="text-sm">Entered: {formatNaira(splitSum)} of {formatNaira(subtotal)}</p>
            {splitSum !== subtotal && <p className="text-sm text-destructive">
              {splitSum < subtotal ? `${formatNaira(subtotal - splitSum)} still needed` : `${formatNaira(splitSum - subtotal)} too much`}</p>}
            {splitSum === subtotal && (cashK <= 0 || trK <= 0) && <p className="text-sm text-destructive">Both amounts must be more than ₦0 for a split.</p>}
          </div>)}
      </section>
      </fieldset>

      <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>{busy ? "Saving…" : pay === "credit" ? `Put ${formatNaira(subtotal)} on credit` : pay === "auto_transfer" ? `Ask for ${formatNaira(subtotal)} by transfer` : `Charge ${formatNaira(subtotal)}`}</Button>
      {!conn.isOnline && !locked && <p className="text-sm text-destructive">Cannot save while the connection is not confirmed. Use the paper fallback form.</p>}
      {msg && <p className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}

      <section className="space-y-1 border-t pt-3">
        <Label htmlFor="till-label">This till's name (printed on paper forms)</Label>
        <Input id="till-label" placeholder="e.g. Till 1 — Counter" value={tillLabel}
          onChange={(e) => setTillLabelState(e.target.value)} onBlur={() => setTillLabel(tillLabel.trim())} />
      </section>
    </main>
  );
}
