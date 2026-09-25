// The ONE place payout variance is worked out.
export const MISMATCH_CRITICAL_KOBO = 200000; // ₦2,000

export function payoutVariance(gross_sales_kobo: number, commission_kobo: number, net_payout_kobo: number) {
  const expected_net_kobo = gross_sales_kobo - commission_kobo;
  const variance_kobo = net_payout_kobo - expected_net_kobo;
  const severity: "warn" | "critical" | null =
    variance_kobo === 0 ? null : Math.abs(variance_kobo) < MISMATCH_CRITICAL_KOBO ? "warn" : "critical";
  return { expected_net_kobo, variance_kobo, severity };
}

/** Local-day range: from 00:00 on `from` up to (not including) 00:00 the day after `to`. */
export function dayRangeIso(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
