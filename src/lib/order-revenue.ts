// How much of an order counts as sales. One place, used by the profit report, the cost check, the Sales Day Book and the platform view.
// A paper (late) sale paid by split whose transfer never arrived is closed as "transfer_lost" (Master Specification 3.11, Part 9 L1):
// the cash received is kept and counts as sales; the unpaid transfer does not. Every other status keeps the order's total.
export const TRANSFER_LOST = "transfer_lost";

const num = (x: unknown) => (x === null || x === undefined || x === "" ? NaN : Number(x));

type RevenueOrder = { status: string; total_kobo: unknown; cash_amount_kobo?: unknown; transfer_amount_kobo?: unknown };

/** The unpaid transfer of a "transfer lost" order, in kobo (0 for any other order). */
export function lostTransferKobo(o: RevenueOrder): number {
  if (o.status !== TRANSFER_LOST) return 0;
  const transfer = num(o.transfer_amount_kobo);
  if (Number.isFinite(transfer)) return Math.max(0, transfer);
  const cash = num(o.cash_amount_kobo), total = num(o.total_kobo);
  return Number.isFinite(cash) && Number.isFinite(total) ? Math.max(0, total - cash) : 0;
}

/** Money actually received on an order before any part refund. If a transfer-lost order's amounts are missing, nothing is guessed:
 *  the order's total is returned, so the caller must select the amounts. */
export function receivedKobo(o: RevenueOrder): number {
  const total = Number(o.total_kobo ?? 0) || 0;
  return total - lostTransferKobo(o);
}

/** The fraction of an order's value that was received (1 for every normal order). Used to scale line revenue. */
export function receivedShare(o: RevenueOrder): number {
  const total = Number(o.total_kobo ?? 0) || 0;
  return total > 0 ? receivedKobo(o) / total : 1;
}
