// The ONE place "expected cash in a drawer" is worked out.
// Used by closing a shift (server) and by the cashflow forecast (owner screen).
import type { SupabaseClient } from "@supabase/supabase-js";

export type DrawerForExpected = { business_id: string; opening_float_kobo: number | string; opened_at: string };

/**
 * Expected cash = float + cash portion of every PAID (or part-refunded) cash/split order
 * since the shift opened, up to `untilIso`. Voided ('cancelled') and fully 'refunded' orders
 * add nothing. A partial refund comes out of the cash portion (never more than the cash taken).
 */
export async function expectedDrawerCash(
  supabase: SupabaseClient, drawer: DrawerForExpected, untilIso: string,
): Promise<{ cash_sales_kobo: number; expected_cash_kobo: number }> {
  const { data: orders, error: oe } = await supabase.from("orders")
    .select("id,cash_amount_kobo")
    .eq("business_id", drawer.business_id).in("payment_method", ["cash", "split"])
    .in("status", ["paid", "partially_refunded"])
    .gte("created_at", drawer.opened_at).lte("created_at", untilIso);
  if (oe) throw new Error("Could not read orders.");
  const ids = (orders ?? []).map((o) => o.id as string);
  const { data: partials, error: pe } = ids.length
    ? await supabase.from("order_adjustments").select("order_id,adjustment_amount_kobo")
        .eq("type", "partial_refund").in("order_id", ids)
    : { data: [], error: null };
  const refunded = new Map<string, number>();
  // A missing order_adjustments table (script not run) just means "no refunds yet".
  for (const a of pe ? [] : partials ?? []) {
    refunded.set(a.order_id, (refunded.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo));
  }
  const cash_sales_kobo = (orders ?? []).reduce(
    (s, o) => s + Math.max(0, Number(o.cash_amount_kobo) - (refunded.get(o.id) ?? 0)), 0);
  return { cash_sales_kobo, expected_cash_kobo: Number(drawer.opening_float_kobo) + cash_sales_kobo };
}
