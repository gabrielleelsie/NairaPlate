// The ONE place "expected cash in a drawer" is worked out, and how a closed shift's count is adjusted.
// Used by closing a shift (server) and by the cashflow forecast (owner screen).
// A closed shift is never edited. A wrong count is corrected by an owner-only adjustment entry shown beside the original.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOwnerRole } from "@/lib/catering-order";

export type DrawerForExpected = { id: string; business_id: string; opening_float_kobo: number | string; opened_at: string };

export type DrawerExpected = { cash_sales_kobo: number; catering_cash_kobo: number; debt_cash_kobo: number; payouts_kobo: number; expected_cash_kobo: number };

export const sumKobo = (rows: { amount_kobo: unknown }[] | null | undefined): number => (rows ?? []).reduce((s, r) => s + Number(r.amount_kobo), 0);

/**
 * Expected cash = float + cash portion of every PAID (or part-refunded) cash/split order since the shift opened, up to `untilIso`
 * + cash catering payments (deposits included, once they carry a cash method) + cash debt payments recorded in the same window
 * - cash paid out of the drawer on this shift (payout entries minus reversals; waiting requests and declines do not count).
 * Voided ('cancelled') and fully 'refunded' orders add nothing. A partial refund comes out of the cash portion (never more than the cash taken).
 * PAPER (late) sales are counted by the shift they really happened in, never by when they were approved: a paper sale posted straight to
 * THIS shift ("open_shift_direct") adds its cash portion (also while a split sale still waits for its transfer, because the cash was taken);
 * every other paper sale (closed shift, outside any shift) adds nothing here, because its cash is already in a closed count, an owner adjustment,
 * or belongs to no shift. A paper sale is never counted just because it was approved while this shift was open.
 * Catering and debt reversals are entries too, with the same method and a minus amount, so a payment reversed inside the window nets to nothing.
 * NOT counted: catering deposits taken before methods were saved (the two carried-over ones), and any cash purchase or supplier payment that was
 * not marked "paid from the cash drawer" (those are paid from somewhere else).
 */
export async function expectedDrawerCash(
  supabase: SupabaseClient, drawer: DrawerForExpected, untilIso: string,
): Promise<DrawerExpected> {
  const { data: till, error: oe } = await supabase.from("orders")
    .select("id,cash_amount_kobo")
    .eq("business_id", drawer.business_id).in("payment_method", ["cash", "split"])
    .in("status", ["paid", "partially_refunded"])
    .or("is_late_entry.is.null,is_late_entry.eq.false")
    .gte("created_at", drawer.opened_at).lte("created_at", untilIso);
  if (oe) throw new Error("Could not read orders.");
  // Paper sales that belong to this shift, wherever and whenever they were approved.
  const { data: paper, error: pe0 } = await supabase.from("late_entries").select("posted_order_id")
    .eq("business_id", drawer.business_id).eq("source_shift_id", drawer.id).eq("status", "posted").eq("shift_resolution", "open_shift_direct");
  if (pe0) throw new Error("Could not read paper sales.");
  const paperIds = (paper ?? []).map((x) => x.posted_order_id as string | null).filter((x): x is string => !!x);
  const { data: paperOrders, error: po } = paperIds.length
    ? await supabase.from("orders").select("id,cash_amount_kobo")
        .eq("business_id", drawer.business_id).in("id", paperIds).in("payment_method", ["cash", "split"])
        .in("status", ["paid", "partially_refunded", "awaiting_payment"])
    : { data: [], error: null };
  if (po) throw new Error("Could not read paper sales.");
  const orders = [...(till ?? []), ...(paperOrders ?? [])];
  const ids = orders.map((o) => o.id as string);
  const { data: partials, error: pe } = ids.length
    ? await supabase.from("order_adjustments").select("order_id,adjustment_amount_kobo")
        .eq("type", "partial_refund").in("order_id", ids)
    : { data: [], error: null };
  const refunded = new Map<string, number>();
  // A missing order_adjustments table (script not run) just means "no refunds yet".
  for (const a of pe ? [] : partials ?? []) {
    refunded.set(a.order_id, (refunded.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo));
  }
  const cash_sales_kobo = orders.reduce(
    (s, o) => s + Math.max(0, Number(o.cash_amount_kobo) - (refunded.get(o.id) ?? 0)), 0);
  const window = (table: string) => supabase.from(table).select("amount_kobo")
    .eq("business_id", drawer.business_id).eq("method", "cash").gte("created_at", drawer.opened_at).lte("created_at", untilIso);
  const [cat, debt] = await Promise.all([window("catering_payments"), window("credit_payments")]);
  if (cat.error || debt.error) throw new Error("Could not read cash collections.");
  const catering_cash_kobo = sumKobo(cat.data), debt_cash_kobo = sumKobo(debt.data);
  const { data: out, error: oute } = await supabase.from("cash_drawer_payouts").select("amount_kobo").eq("drawer_id", drawer.id).in("kind", ["payout", "reversal"]);
  if (oute) throw new Error("Could not read cash payouts.");
  const payouts_kobo = sumKobo(out);
  return { cash_sales_kobo, catering_cash_kobo, debt_cash_kobo, payouts_kobo, expected_cash_kobo: Number(drawer.opening_float_kobo) + cash_sales_kobo + catering_cash_kobo + debt_cash_kobo - payouts_kobo };
}

export type ShiftRow = {
  id: string; status: "open" | "closed"; opened_at: string; closed_at: string | null; opened_by_name: string | null; closed_by_name: string | null;
  opening_float_kobo: number; closing_counted_kobo: number | null; expected_cash_kobo: number | null; discrepancy_kobo: number | null;
  cash_sales_kobo: number | null; catering_cash_kobo: number | null; debt_cash_kobo: number | null; payouts_kobo: number | null; forced: boolean; close_reason: string | null;
};
export type ShiftAdjustment = { id: string; drawer_id: string; amount_kobo: number; reason: string; recorded_by_name: string | null; created_at: string };

/** The columns the shift list reads. */
export const SHIFT_COLUMNS = "id,status,opened_at,closed_at,opened_by_name,closed_by_name,opening_float_kobo,closing_counted_kobo,expected_cash_kobo,discrepancy_kobo,cash_sales_kobo,catering_cash_kobo,debt_cash_kobo,payouts_kobo,forced,close_reason";

const num = (v: unknown): number | null => (v == null ? null : Number(v));
export function normaliseShifts(rows: unknown[] | null): ShiftRow[] {
  return (rows ?? []).map((r) => {
    const x = r as ShiftRow;
    return { ...x, opening_float_kobo: Number(x.opening_float_kobo), closing_counted_kobo: num(x.closing_counted_kobo), expected_cash_kobo: num(x.expected_cash_kobo),
      discrepancy_kobo: num(x.discrepancy_kobo), cash_sales_kobo: num(x.cash_sales_kobo), catering_cash_kobo: num(x.catering_cash_kobo), debt_cash_kobo: num(x.debt_cash_kobo), payouts_kobo: num(x.payouts_kobo), forced: !!x.forced };
  });
}
export const normaliseAdjustments = (rows: unknown[] | null): ShiftAdjustment[] =>
  (rows ?? []).map((r) => ({ ...(r as ShiftAdjustment), amount_kobo: Number((r as ShiftAdjustment).amount_kobo) }));

export const REASON_MIN = 5;
export const reasonOk = (s: string) => s.trim().length >= REASON_MIN;

/** The count after owner adjustments (null when the shift was closed without a count). The original count is never changed. */
export function adjustedCount(d: Pick<ShiftRow, "id" | "closing_counted_kobo">, adj: ShiftAdjustment[]): number | null {
  if (d.closing_counted_kobo == null) return null;
  return d.closing_counted_kobo + sumKobo(adj.filter((a) => a.drawer_id === d.id));
}
/** Counted (after adjustments) minus expected. null when there was no count. */
export function adjustedDiscrepancy(d: Pick<ShiftRow, "id" | "closing_counted_kobo" | "expected_cash_kobo">, adj: ShiftAdjustment[]): number | null {
  const c = adjustedCount(d, adj);
  return c == null || d.expected_cash_kobo == null ? null : c - d.expected_cash_kobo;
}
/** What to add so the count becomes the correct figure. null when it cannot be adjusted; 0 means no change. */
export function adjustmentDelta(correctKobo: number, d: Pick<ShiftRow, "id" | "closing_counted_kobo">, adj: ShiftAdjustment[]): number | null {
  const c = adjustedCount(d, adj);
  return c == null || !Number.isFinite(correctKobo) || correctKobo < 0 ? null : correctKobo - c;
}
/** Only an owner, only a closed shift that has a count. */
export const canAdjust = (d: Pick<ShiftRow, "status" | "closing_counted_kobo">, role: string | null | undefined) => isOwnerRole(role) && d.status === "closed" && d.closing_counted_kobo != null;
/** Only an owner, only an open shift. */
export const canForceClose = (d: Pick<ShiftRow, "status">, role: string | null | undefined) => isOwnerRole(role) && d.status === "open";

/** A short word for the shift on the list. */
export function shiftLabel(d: Pick<ShiftRow, "status" | "forced" | "closing_counted_kobo">): string {
  if (d.status === "open") return "Open";
  if (d.forced) return d.closing_counted_kobo == null ? "Closed by owner, not counted" : "Closed by owner";
  return "Closed";
}
