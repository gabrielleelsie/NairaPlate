// Accountant reports: read-only views of existing ledgers. Builders are pure (tested); fetchers read only the business's own rows.
// Costs are never recalculated here: sales use the food-cost label stored on each line, batches use the cost locked in when logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import { koboInt, koboToNaira, lagosDate, lagosDateTime, lagosTime, daysBetween, type CsvRow, type ReportId } from "@/lib/csv-export";
import { SHIFT_COLUMNS, normaliseShifts, normaliseAdjustments, adjustedCount, adjustedDiscrepancy, type ShiftRow, type ShiftAdjustment } from "@/lib/cash-drawer";
import { PAYOUT_COLUMNS, normalisePayouts, payoutViews, categoryLabel, type PayoutRow } from "@/lib/cash-payouts";
import { TXN_COLUMNS, normaliseTxns, signedAmount, type SupplierTxn } from "@/lib/suppliers";

export type Range = { fromIso: string; toIso: string; fromKey: string; toKey: string };
const n = (v: unknown) => Number(v ?? 0) || 0;

// ---------- Ageing ----------
export type Ageing = { d0_30: number; d31_60: number; d61_90: number; d90: number };
/** Splits an outstanding balance across the newest charges first (oldest charges are assumed paid first). */
export function ageBalance(balanceKobo: number, charges: { dateKey: string; kobo: number }[], asOfKey: string): Ageing {
  const out: Ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  let left = Math.max(0, balanceKobo);
  for (const c of [...charges].sort((a, b) => b.dateKey.localeCompare(a.dateKey))) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, c.kobo)); left -= take;
    const age = daysBetween(c.dateKey, asOfKey);
    if (age <= 30) out.d0_30 += take; else if (age <= 60) out.d31_60 += take; else if (age <= 90) out.d61_90 += take; else out.d90 += take;
  }
  out.d90 += left; // balance older than any known charge
  return out;
}
const ageingCols = (a: Ageing) => ({
  balance_0_30_days_naira: koboToNaira(a.d0_30), balance_31_60_days_naira: koboToNaira(a.d31_60),
  balance_61_90_days_naira: koboToNaira(a.d61_90), balance_over_90_days_naira: koboToNaira(a.d90),
});

// ---------- 1. Sales Day Book ----------
export type SaleOrder = { id: string; subtotal_kobo: unknown; total_kobo: unknown; status: string; payment_method: string | null; channel: string | null; created_by: string | null; created_at: string; is_late_entry?: boolean | null; actual_sold_at?: string | null; paper_reference?: string | null };
export type OrderAdj = { id: string; order_id: string; type: string; original_amount_kobo?: unknown; adjustment_amount_kobo: unknown; reason?: string | null; actor_id?: string | null; created_at: string };

export function costConfidence(isLate: boolean, bases: (string | null)[]): string {
  if (!isLate) return "snapshot";
  if (bases.length === 0) return "";
  if (bases.some((b) => b === "unknown_held" || b === "estimated_current_price" || b == null)) return "low";
  if (bases.some((b) => b === "sale_time_backfilled")) return "medium";
  return bases.every((b) => b === "sale_time_exact") ? "high" : "";
}

export function refundedKobo(o: Pick<SaleOrder, "status" | "total_kobo">, adjs: OrderAdj[]): number {
  if (o.status === "cancelled" || o.status === "refunded") return n(o.total_kobo);
  return adjs.filter((a) => a.type === "partial_refund").reduce((s, a) => s + n(a.adjustment_amount_kobo), 0);
}

const STATUS_OUT: Record<string, string> = { cancelled: "voided" };
/** Receipt columns. counts === null means the photo counts could not be read: cells stay blank (unknown), never a false 0. */
export function receiptCols(counts: Map<string, number> | null, id: string | null, eligible = true) {
  if (!eligible) return { receipt_attached: false, receipt_count: 0 };
  if (counts === null || id === null) return { receipt_attached: "", receipt_count: "" };
  const c = counts.get(id) ?? 0;
  return { receipt_attached: c > 0, receipt_count: c };
}

/** receiptCounts is keyed by ORDER id (the fetcher maps late_entries.id -> posted_order_id). */
export function buildSalesDayBook(orders: SaleOrder[], adjs: OrderAdj[], bases: Map<string, (string | null)[]>, names: Map<string, string>, receiptCounts: Map<string, number> | null = new Map()): CsvRow[] {
  const byOrder = new Map<string, OrderAdj[]>();
  for (const a of adjs) byOrder.set(a.order_id, [...(byOrder.get(a.order_id) ?? []), a]);
  return [...orders].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((o) => {
    const gross = n(o.total_kobo), refunded = refundedKobo(o, byOrder.get(o.id) ?? []), net = gross - refunded;
    return {
      lagos_date: lagosDate(o.created_at), lagos_time: lagosTime(o.created_at), order_ref: `#${o.id.slice(0, 8)}`, order_id: o.id,
      status: STATUS_OUT[o.status] ?? o.status, channel: o.channel ?? "", payment_method: o.payment_method ?? "",
      subtotal_naira: koboToNaira(n(o.subtotal_kobo)), gross_sales_naira: koboToNaira(gross), refunded_naira: koboToNaira(refunded),
      net_sales_naira: koboToNaira(net), net_sales_kobo: koboInt(net),
      cost_confidence: costConfidence(!!o.is_late_entry, bases.get(o.id) ?? []), is_late_entry: !!o.is_late_entry,
      actual_sold_at_lagos: o.is_late_entry ? lagosDateTime(o.actual_sold_at) : "", paper_reference: o.paper_reference ?? "",
      ...receiptCols(receiptCounts, o.id, !!o.is_late_entry),
      cashier_name: (o.created_by && names.get(o.created_by)) || "", created_at_utc: o.created_at,
    };
  });
}

// ---------- 2. Cash Drawer Summary ----------
export function buildDrawerSummary(shifts: ShiftRow[], adj: ShiftAdjustment[]): CsvRow[] {
  const sorted = [...shifts].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  const perDay = new Map<string, number>();
  return sorted.map((d) => {
    const day = lagosDate(d.opened_at); const num = (perDay.get(day) ?? 0) + 1; perDay.set(day, num);
    const ownerAdj = adj.filter((a) => a.drawer_id === d.id).reduce((s, a) => s + a.amount_kobo, 0);
    const k = (v: number | null) => (v == null ? "" : koboToNaira(v));
    return {
      shift_id: d.id, lagos_date: day, shift_number: num, opened_at_lagos: lagosDateTime(d.opened_at), closed_at_lagos: lagosDateTime(d.closed_at),
      opened_by: d.opened_by_name ?? "", closed_by: d.closed_by_name ?? "", status: d.status,
      opening_float_naira: koboToNaira(d.opening_float_kobo), opening_float_kobo: koboInt(d.opening_float_kobo),
      cash_sales_naira: k(d.cash_sales_kobo), catering_cash_naira: k(d.catering_cash_kobo), debt_cash_naira: k(d.debt_cash_kobo), payouts_naira: k(d.payouts_kobo),
      expected_cash_naira: k(d.expected_cash_kobo), closing_counted_naira: k(d.closing_counted_kobo), discrepancy_naira: k(d.discrepancy_kobo),
      owner_adjustments_naira: koboToNaira(ownerAdj), final_adjusted_cash_naira: k(adjustedCount(d, adj)), final_discrepancy_naira: k(adjustedDiscrepancy(d, adj)),
      is_owner_closed: d.forced, forced: d.forced, discrepancy_explanation: d.close_reason ?? "",
    };
  });
}

// ---------- 3. Cash Paid-Out Register ----------
export function buildPayoutRegister(rows: PayoutRow[], receiptCounts: Map<string, number> | null = new Map()): CsvRow[] {
  const views = new Map(payoutViews(rows).map((v) => [v.id, v]));
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((r) => {
    const v = views.get(r.id);
    return {
      payout_id: r.id, lagos_date: lagosDate(r.created_at), lagos_time: lagosTime(r.created_at), shift_id: r.drawer_id,
      category: categoryLabel(r.category), amount_naira: koboToNaira(r.amount_kobo), amount_kobo: koboInt(r.amount_kobo),
      kind: r.approves_id ? "payout (approval)" : r.kind, status: v?.status ?? "", reason_note: r.note ?? "", ...receiptCols(receiptCounts, r.id), paid_by: r.recorded_by_name ?? "",
      approved_by: v?.status === "approved" ? v.settledBy ?? "" : "", reversal_reason: v?.status === "reversed" ? v.settledNote ?? "" : "",
      created_at_utc: r.created_at,
    };
  });
}

// ---------- 4. Supplier Ledger ----------
export function buildSupplierLedger(suppliers: { id: string; name: string; phone: string | null }[], txns: SupplierTxn[], range: Range): CsvRow[] {
  return [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const mine = txns.filter((t) => t.supplier_id === s.id && t.created_at < range.toIso);
    const before = mine.filter((t) => t.created_at < range.fromIso), inside = mine.filter((t) => t.created_at >= range.fromIso);
    const opening = before.reduce((x, t) => x + signedAmount(t), 0);
    const sum = (type: SupplierTxn["type"][]) => inside.filter((t) => type.includes(t.type)).reduce((x, t) => x + signedAmount(t), 0);
    const closing = opening + inside.reduce((x, t) => x + signedAmount(t), 0);
    const charges = mine.filter((t) => t.type === "purchase_on_credit").map((t) => ({ dateKey: lagosDate(t.created_at), kobo: t.amount_kobo }));
    const last = mine.reduce<string | null>((m, t) => (!m || t.created_at > m ? t.created_at : m), null);
    return {
      supplier_id: s.id, supplier_name: s.name, phone: s.phone ?? "", opening_balance_naira: koboToNaira(opening),
      purchases_on_credit_naira: koboToNaira(sum(["purchase_on_credit"])), payments_made_naira: koboToNaira(-sum(["payment"])),
      reversals_naira: koboToNaira(sum(["reversal", "purchase_reversal"])), closing_balance_naira: koboToNaira(closing), closing_balance_kobo: koboInt(closing),
      ...ageingCols(ageBalance(closing, charges, range.toKey)), last_transaction_date_lagos: lagosDate(last),
    };
  });
}

// ---------- 5. Customer Ledger ----------
export type Credit = { id: string; customer_name: string; phone: string | null; amount_kobo: unknown; created_at: string; order_id?: string | null };
export type CreditEntry = { id: string; credit_id: string; kind: "payment" | "write_off" | "reversal"; amount_kobo: unknown; reverses_id: string | null; created_at: string };

export function buildCustomerLedger(credits: Credit[], entries: CreditEntry[], range: Range): CsvRow[] {
  const kindOf = new Map(entries.map((e) => [e.id, e.kind]));
  const rows: CsvRow[] = [];
  for (const c of [...credits].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (c.created_at >= range.toIso) continue;
    const mine = entries.filter((e) => e.credit_id === c.id && e.created_at < range.toIso);
    let paid = 0, written = 0;
    for (const e of mine) {
      const amt = n(e.amount_kobo);
      if (e.kind === "payment") paid += amt; else if (e.kind === "write_off") written += amt;
      else if (e.reverses_id) { if (kindOf.get(e.reverses_id) === "write_off") written += amt; else paid += amt; }
    }
    const original = n(c.amount_kobo), balance = original - paid - written;
    const active = mine.some((e) => e.created_at >= range.fromIso) || c.created_at >= range.fromIso;
    if (balance <= 0 && !active) continue;
    const lastPay = mine.filter((e) => e.kind === "payment").reduce<string | null>((m, e) => (!m || e.created_at > m ? e.created_at : m), null);
    rows.push({
      credit_id: c.id, customer_name: c.customer_name, phone: c.phone ?? "", created_date_lagos: lagosDate(c.created_at),
      original_credit_naira: koboToNaira(original), total_payments_naira: koboToNaira(paid), total_writeoffs_naira: koboToNaira(written),
      balance_owed_naira: koboToNaira(balance), balance_owed_kobo: koboInt(balance),
      ...ageingCols(ageBalance(balance, [{ dateKey: lagosDate(c.created_at), kobo: original }], range.toKey)),
      status: balance > 0 ? "owing" : "settled", last_payment_date_lagos: lagosDate(lastPay), order_id: c.order_id ?? "",
    });
  }
  return rows;
}

// ---------- 6. Refund & Reversal Register ----------
export type Reversal = { id: string; reverses_id: string | null; amount_kobo: unknown; reason: string | null; recorded_by_name: string | null; created_at: string };
export function buildRefundRegister(i: {
  orderAdjs: OrderAdj[]; allPartials: OrderAdj[]; orderTotals: Map<string, number>; names: Map<string, string>;
  supplier: (Reversal & { type: string; supplier_id: string })[]; payouts: (Reversal & { drawer_id: string })[];
  credit: (Reversal & { credit_id: string })[]; batches: (Reversal & { recipe_id: string })[];
}): CsvRow[] {
  const rows: (CsvRow & { created_at_utc: string })[] = [];
  const base = (id: string, at: string) => ({ event_id: id, lagos_date: lagosDate(at), lagos_time: lagosTime(at), created_at_utc: at });
  for (const a of i.orderAdjs) {
    const amt = n(a.adjustment_amount_kobo);
    let remaining: string = "";
    if (a.type === "partial_refund") {
      const orig = i.orderTotals.get(a.order_id) ?? n(a.original_amount_kobo);
      const upTo = i.allPartials.filter((p) => p.order_id === a.order_id && (p.created_at < a.created_at || (p.created_at === a.created_at && p.id <= a.id)))
        .reduce((s, p) => s + n(p.adjustment_amount_kobo), 0);
      remaining = koboToNaira(Math.max(0, orig - upTo));
    }
    rows.push({ ...base(a.id, a.created_at), module: "Till Sales", action_type: a.type, reference_id: a.order_id, reversed_module: "Till Sales",
      reversed_record_id: a.order_id, amount_naira: koboToNaira(amt), amount_kobo: koboInt(amt), remaining_refundable_naira: remaining,
      reason: a.reason ?? "", authorized_by: (a.actor_id && i.names.get(a.actor_id)) || "" });
  }
  const push = (module: string, r: Reversal, ref: string) => {
    const amt = Math.abs(n(r.amount_kobo));
    rows.push({ ...base(r.id, r.created_at), module, action_type: "reversal", reference_id: ref, reversed_module: module,
      reversed_record_id: r.reverses_id ?? "", amount_naira: koboToNaira(amt), amount_kobo: koboInt(amt), remaining_refundable_naira: "",
      reason: r.reason ?? "", authorized_by: r.recorded_by_name ?? "" });
  };
  for (const r of i.supplier) push("Suppliers", r, r.supplier_id);
  for (const r of i.payouts) push("Cash Drawer", r, r.drawer_id);
  for (const r of i.credit) push("Customer Credit", r, r.credit_id);
  for (const r of i.batches) push("Kitchen Batches", r, r.recipe_id);
  return rows.sort((a, b) => a.created_at_utc.localeCompare(b.created_at_utc));
}

// ---------- 7. Wastage Log ----------
export type Wastage = { id: string; ingredient_id: string; qty: unknown; unit: string; cost_kobo: unknown; reason: string | null; logged_by: string | null; created_at: string };
export function buildWastageLog(rows: Wastage[], ingredients: Map<string, string>, names: Map<string, string>): CsvRow[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((w) => {
    const qty = n(w.qty), cost = n(w.cost_kobo);
    return { wastage_id: w.id, lagos_date: lagosDate(w.created_at), lagos_time: lagosTime(w.created_at), ingredient_name: ingredients.get(w.ingredient_id) ?? "",
      quantity: qty, unit: w.unit.replaceAll("_", " "), unit_cost_naira: qty > 0 ? koboToNaira(cost / qty) : "",
      total_cost_naira: koboToNaira(cost), total_cost_kobo: koboInt(cost), reason: w.reason ?? "",
      logged_by: (w.logged_by && names.get(w.logged_by)) || "", created_at_utc: w.created_at };
  });
}

// ---------- 8. Batch Production ----------
export type Batch = { id: string; recipe_id: string; actual_yield: unknown; ingredient_cost_kobo: unknown; packaging_kobo: unknown; utilities_kobo: unknown; created_at: string; kind?: string | null; reverses_id?: string | null; reason?: string | null; recorded_by_name?: string | null };
export function buildBatchProduction(rows: Batch[], recipes: Map<string, { name: string; yield_portions: number }>, allReversals: Batch[]): CsvRow[] {
  const reversedBy = new Map(allReversals.filter((r) => r.reverses_id).map((r) => [r.reverses_id!, r]));
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((b) => {
    const total = n(b.ingredient_cost_kobo) + n(b.packaging_kobo) + n(b.utilities_kobo);
    const yieldN = b.actual_yield == null ? null : n(b.actual_yield);
    const rec = recipes.get(b.recipe_id); const rev = reversedBy.get(b.id); const isRev = b.kind === "reversal";
    return { batch_id: b.id, lagos_date: lagosDate(b.created_at), lagos_time: lagosTime(b.created_at), recipe_name: rec?.name ?? "",
      target_yield: rec?.yield_portions ?? "", actual_portions: yieldN ?? "", ingredient_cost_naira: koboToNaira(n(b.ingredient_cost_kobo)),
      packaging_cost_naira: koboToNaira(n(b.packaging_kobo)), utility_cost_naira: koboToNaira(n(b.utilities_kobo)),
      total_batch_cost_naira: koboToNaira(total), total_batch_cost_kobo: koboInt(total),
      realized_cost_per_plate_naira: yieldN && yieldN > 0 ? koboToNaira(total / yieldN) : "", cost_source: "snapshot",
      entry_kind: isRev ? "reversal" : "entry", reversal_status: isRev ? `reverses ${b.reverses_id ?? ""}` : rev ? "reversed" : "active",
      reversal_reason: isRev ? b.reason ?? "" : rev?.reason ?? "", recorded_by: b.recorded_by_name ?? "", created_at_utc: b.created_at };
  });
}

// ================= Fetchers =================
type Q = { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
async function all<T>(make: () => Q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}
async function inChunks<T>(ids: string[], make: (chunk: string[]) => Q): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await all<T>(() => make(ids.slice(i, i + 150)))));
  return out;
}

export type Ctx = { supabase: SupabaseClient; businessId: string; range: Range };
const within = (ctx: Ctx, table: string, cols: string, col = "created_at") =>
  () => ctx.supabase.from(table).select(cols).eq("business_id", ctx.businessId).gte(col, ctx.range.fromIso).lt(col, ctx.range.toIso).order(col) as unknown as Q;

/** Active photo counts per record (owner/Supa Admin only, voided photos excluded). null = could not be read. */
async function receiptCountMap(ctx: Ctx, type: "late_entry" | "payout", ids: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await ctx.supabase.rpc("receipt_counts", { p_record_type: type, p_record_ids: ids.slice(i, i + 150) });
      if (error) throw error;
      for (const r of (data ?? []) as { record_id: string; receipt_count: number }[]) out.set(r.record_id, Number(r.receipt_count) || 0);
    }
    return out;
  } catch (e) {
    console.error("[exports] receipt_counts failed; receipt columns left blank", e);
    return null;
  }
}

async function staffNames(ctx: Ctx) {
  const rows = await all<{ id: string; display_name: string }>(() => ctx.supabase.from("staff_users").select("id,display_name").eq("business_id", ctx.businessId) as unknown as Q);
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

const FETCHERS: Record<ReportId, (ctx: Ctx) => Promise<CsvRow[]>> = {
  async sales_day_book(ctx) {
    const orders = await all<SaleOrder>(within(ctx, "orders", "id,subtotal_kobo,total_kobo,status,payment_method,channel,created_by,created_at,is_late_entry,actual_sold_at,paper_reference"));
    const ids = orders.map((o) => o.id), lateIds = orders.filter((o) => o.is_late_entry).map((o) => o.id);
    const [adjs, items, names] = await Promise.all([
      inChunks<OrderAdj>(ids, (c) => ctx.supabase.from("order_adjustments").select("id,order_id,type,adjustment_amount_kobo,created_at").in("order_id", c) as unknown as Q),
      inChunks<{ order_id: string; cost_basis: string | null }>(lateIds, (c) => ctx.supabase.from("order_items").select("order_id,cost_basis").in("order_id", c) as unknown as Q),
      staffNames(ctx),
    ]);
    const bases = new Map<string, (string | null)[]>();
    for (const it of items) bases.set(it.order_id, [...(bases.get(it.order_id) ?? []), it.cost_basis]);
    // Photos are attached to the paper record (late_entries.id), not the order: join via posted_order_id.
    let receipts: Map<string, number> | null = new Map();
    try {
      const les = await inChunks<{ id: string; posted_order_id: string | null }>(lateIds, (c) => ctx.supabase.from("late_entries").select("id,posted_order_id").eq("business_id", ctx.businessId).in("posted_order_id", c) as unknown as Q);
      const byLe = await receiptCountMap(ctx, "late_entry", les.map((l) => l.id));
      if (byLe === null) receipts = null;
      else for (const l of les) if (l.posted_order_id) receipts.set(l.posted_order_id, (receipts.get(l.posted_order_id) ?? 0) + (byLe.get(l.id) ?? 0));
    } catch (e) { console.error("[exports] late_entries lookup failed; receipt columns left blank", e); receipts = null; }
    return buildSalesDayBook(orders.filter((o) => o.status !== "draft"), adjs, bases, names, receipts);
  },
  async cash_drawer_summary(ctx) {
    const shifts = normaliseShifts(await all(within(ctx, "cash_drawers", SHIFT_COLUMNS, "opened_at")));
    const adj = normaliseAdjustments(await inChunks(shifts.map((s) => s.id), (c) => ctx.supabase.from("cash_drawer_adjustments").select("id,drawer_id,amount_kobo,reason,recorded_by_name,created_at").in("drawer_id", c) as unknown as Q));
    return buildDrawerSummary(shifts, adj);
  },
  async cash_paid_out_register(ctx) {
    const rows = normalisePayouts(await all(within(ctx, "cash_drawer_payouts", PAYOUT_COLUMNS)));
    return buildPayoutRegister(rows, await receiptCountMap(ctx, "payout", rows.map((r) => r.id)));
  },
  async supplier_ledger(ctx) {
    const [sup, txns] = await Promise.all([
      all<{ id: string; name: string; phone: string | null }>(() => ctx.supabase.from("suppliers").select("id,name,phone").eq("business_id", ctx.businessId).order("name") as unknown as Q),
      all(() => ctx.supabase.from("supplier_transactions").select(TXN_COLUMNS).eq("business_id", ctx.businessId).lt("created_at", ctx.range.toIso).order("created_at") as unknown as Q),
    ]);
    return buildSupplierLedger(sup, normaliseTxns(txns), ctx.range);
  },
  async customer_ledger(ctx) {
    const [credits, entries] = await Promise.all([
      all<Credit>(() => ctx.supabase.from("customer_credits").select("id,customer_name,phone,amount_kobo,created_at,order_id").eq("business_id", ctx.businessId).lt("created_at", ctx.range.toIso).order("created_at") as unknown as Q),
      all<CreditEntry>(() => ctx.supabase.from("credit_payments").select("id,credit_id,kind,amount_kobo,reverses_id,created_at").eq("business_id", ctx.businessId).lt("created_at", ctx.range.toIso).order("created_at") as unknown as Q),
    ]);
    return buildCustomerLedger(credits, entries, ctx.range);
  },
  async refund_reversal_register(ctx) {
    const rev = (table: string, cols: string, kindCol: string, kinds: string[]) =>
      all(() => ctx.supabase.from(table).select(cols).eq("business_id", ctx.businessId).in(kindCol, kinds).gte("created_at", ctx.range.fromIso).lt("created_at", ctx.range.toIso).order("created_at") as unknown as Q);
    const [orderAdjs, supplier, payouts, credit, batches, names] = await Promise.all([
      all<OrderAdj>(within(ctx, "order_adjustments", "id,order_id,type,original_amount_kobo,adjustment_amount_kobo,reason,actor_id,created_at")),
      rev("supplier_transactions", "id,supplier_id,type,reverses_id,amount_kobo,reason,recorded_by_name,created_at", "type", ["reversal", "purchase_reversal"]),
      rev("cash_drawer_payouts", "id,drawer_id,reverses_id,amount_kobo,note,recorded_by_name,created_at", "kind", ["reversal"]),
      rev("credit_payments", "id,credit_id,reverses_id,amount_kobo,reason,recorded_by_name,created_at", "kind", ["reversal"]),
      rev("batches", "id,recipe_id,reverses_id,ingredient_cost_kobo,packaging_kobo,utilities_kobo,reason,recorded_by_name,created_at", "kind", ["reversal"]),
      staffNames(ctx),
    ]);
    const partialIds = [...new Set(orderAdjs.filter((a) => a.type === "partial_refund").map((a) => a.order_id))];
    const [allPartials, totals] = await Promise.all([
      inChunks<OrderAdj>(partialIds, (c) => ctx.supabase.from("order_adjustments").select("id,order_id,type,adjustment_amount_kobo,created_at").eq("type", "partial_refund").in("order_id", c) as unknown as Q),
      inChunks<{ id: string; total_kobo: unknown }>(partialIds, (c) => ctx.supabase.from("orders").select("id,total_kobo").in("id", c) as unknown as Q),
    ]);
    type R = Record<string, unknown>;
    return buildRefundRegister({
      orderAdjs, allPartials, orderTotals: new Map(totals.map((t) => [t.id, n(t.total_kobo)])), names,
      supplier: supplier as never, credit: credit as never,
      payouts: (payouts as R[]).map((p) => ({ ...p, reason: p["note"] })) as never,
      batches: (batches as R[]).map((b) => ({ ...b, amount_kobo: n(b["ingredient_cost_kobo"]) + n(b["packaging_kobo"]) + n(b["utilities_kobo"]) })) as never,
    });
  },
  async wastage_log(ctx) {
    const [rows, ings, names] = await Promise.all([
      all<Wastage>(within(ctx, "wastage_logs", "id,ingredient_id,qty,unit,cost_kobo,reason,logged_by,created_at")),
      all<{ id: string; name: string }>(() => ctx.supabase.from("ingredients").select("id,name").eq("business_id", ctx.businessId) as unknown as Q),
      staffNames(ctx),
    ]);
    return buildWastageLog(rows, new Map(ings.map((i) => [i.id, i.name])), names);
  },
  async batch_production(ctx) {
    const cols = "id,recipe_id,actual_yield,ingredient_cost_kobo,packaging_kobo,utilities_kobo,created_at,kind,reverses_id,reason,recorded_by_name";
    const [rows, recipes, reversals] = await Promise.all([
      all<Batch>(within(ctx, "batches", cols)),
      all<{ id: string; name: string; yield_portions: unknown }>(() => ctx.supabase.from("recipes").select("id,name,yield_portions").eq("business_id", ctx.businessId) as unknown as Q),
      all<Batch>(() => ctx.supabase.from("batches").select(cols).eq("business_id", ctx.businessId).eq("kind", "reversal") as unknown as Q),
    ]);
    return buildBatchProduction(rows, new Map(recipes.map((r) => [r.id, { name: r.name, yield_portions: n(r.yield_portions) }])), reversals);
  },
};

export const fetchReport = (id: ReportId, ctx: Ctx) => FETCHERS[id](ctx);

/** The kobo column summed on the cover sheet for each report. */
export const AMOUNT_COLUMN: Record<ReportId, string> = {
  sales_day_book: "net_sales_kobo", cash_drawer_summary: "opening_float_kobo", cash_paid_out_register: "amount_kobo",
  supplier_ledger: "closing_balance_kobo", customer_ledger: "balance_owed_kobo", refund_reversal_register: "amount_kobo",
  wastage_log: "total_cost_kobo", batch_production: "total_batch_cost_kobo",
};
