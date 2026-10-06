// What the owner must do to approve a paper (late) sale, and how a paper transfer is confirmed.
// The database decides and refuses; this only mirrors its rules so the screen can ask for the right thing before sending.
// Rules (Master Specification 3.11): the sale belongs to the shift it really happened in.
//  - shift still open       -> posted straight to it, nothing to choose
//  - shift now closed       -> choose "already included" or "late cash", and give a reason
//  - no shift at all        -> only "cash outside any shift", with a reason (or reject the entry)

export const REASON_MIN = 5;

export type ShiftSituation = "open" | "closed" | "outside";
export type ClosedChoice = "closed_shift_included" | "closed_shift_late_cash";

/** drawerStatus: the status of the entry's real shift, or undefined if it could not be read. */
export function shiftSituation(e: { source_shift_id: string | null; status: string }, drawerStatus: string | undefined): ShiftSituation {
  if (!e.source_shift_id) return "outside";
  if (drawerStatus === "open") return "open";
  if (drawerStatus === "closed") return "closed";
  // Could not read the shift: trust the entry's own status; the database re-checks and says if this was wrong.
  return e.status === "needs_shift_review" ? "closed" : "open";
}

const enough = (s: string) => s.trim().length >= REASON_MIN;

/** Why Approve must stay disabled, or null when it can be sent. */
export function approvalProblem(situation: ShiftSituation, choice: string, reason: string): string | null {
  if (situation === "open") return null;
  if (situation === "outside") return enough(reason) ? null : `Type a reason of at least ${REASON_MIN} characters for cash outside any shift.`;
  if (choice !== "closed_shift_included" && choice !== "closed_shift_late_cash") return "Choose what happened to this cash.";
  return enough(reason) ? null : `Type a reason of at least ${REASON_MIN} characters for your choice.`;
}

/** The two values the approval needs besides the cost decision. */
export function approvalArgs(situation: ShiftSituation, choice: string, reason: string): { p_shift_resolution: string | null; p_notes: string | null } {
  if (situation === "open") return { p_shift_resolution: null, p_notes: null };
  if (situation === "outside") return { p_shift_resolution: "outside_shift_cash", p_notes: reason.trim() };
  return { p_shift_resolution: choice, p_notes: reason.trim() };
}

export const RESOLUTION_LABEL: Record<string, string> = {
  open_shift_direct: "posted straight into the shift it happened in",
  closed_shift_included: "cash was already included in that closed shift's count",
  closed_shift_late_cash: "cash added to that closed shift as late cash",
  outside_shift_cash: "cash outside any shift (no drawer)",
};

/** Why Confirm transfer must stay disabled, or null. */
export function transferProblem(proof: string, reason: string): string | null {
  if (!enough(proof)) return `Type the bank reference or a short proof note (at least ${REASON_MIN} characters).`;
  if (!enough(reason)) return `Type a reason of at least ${REASON_MIN} characters.`;
  return null;
}

/** A posted paper sale still waiting for its transfer. */
export function awaitingTransfer(e: { status: string; transfer_kobo: number | string }, orderStatus: string | undefined): boolean {
  return e.status === "posted" && Number(e.transfer_kobo) > 0 && orderStatus === "awaiting_payment";
}

export const LOSS_REASON_MIN = 10;

/** Why "Mark transfer as lost" must stay disabled, or null. */
export function lostProblem(reason: string): string | null {
  return reason.trim().length >= LOSS_REASON_MIN ? null : `Type a reason of at least ${LOSS_REASON_MIN} characters.`;
}

/** A posted paper sale that still waits for its transfer AND has cash already taken: the only kind that can be closed as "transfer lost".
 *  (A transfer-only sale that never arrives is cancelled as an unpaid order instead.) */
export function canMarkLost(e: { status: string; cash_kobo: number | string; transfer_kobo: number | string }, orderStatus: string | undefined): boolean {
  return awaitingTransfer(e, orderStatus) && Number(e.cash_kobo) > 0;
}

/** A paper sale whose transfer was closed as lost: the cash was kept. */
export function isTransferLost(e: { status: string }, orderStatus: string | undefined): boolean {
  return e.status === "posted" && orderStatus === "transfer_lost";
}
