// Sales finished with no internet. Kept on the phone until they can be sent (Stage 3).
// Pure rules live here so they can be tested. Never stores PINs, tokens or payment keys.
import type { PayChoice } from "./payment-ui";
import type { DraftLine } from "./pos-draft";

export type OfflinePay = "cash" | "credit";
export type QueuedSale = {
  clientSaleId: string;
  businessId: string;
  userId: string;
  /** Device clock. Shown to the owner as a note only; never used as the sale time. */
  savedAtUtc: string;
  paperReference: string;
  channel: string;
  tier: string;
  pay: OfflinePay;
  lines: DraftLine[];
  /** What the phone showed at the time. The database works out the real total. */
  shownTotalKobo: number;
  custName?: string;
  custPhone?: string;
  status: "waiting" | "sent" | "failed";
  lastError?: string;
};

/** Only cash and credit can be sold with no internet. A bank transfer needs the bank to confirm it. */
export function offlinePayAllowed(pay: PayChoice): pay is OfflinePay {
  return pay === "cash" || pay === "credit";
}

export const OFFLINE_TRANSFER_BLOCK =
  "Transfer and split sales need internet, because the bank has to confirm the money. Take cash, put it on credit, or wait until the internet is back.";

export function buildQueuedSale(i: {
  clientSaleId: string; businessId: string; userId: string; nowIso: string; paperReference: string;
  channel: string; tier: string; pay: PayChoice; lines: DraftLine[]; shownTotalKobo: number; custName?: string; custPhone?: string;
}): QueuedSale | null {
  if (!offlinePayAllowed(i.pay) || i.lines.length === 0 || !(i.shownTotalKobo > 0)) return null;
  if (i.pay === "credit" && (!i.custName?.trim() || !i.custPhone?.trim())) return null;
  const base = {
    clientSaleId: i.clientSaleId, businessId: i.businessId, userId: i.userId, savedAtUtc: i.nowIso, paperReference: i.paperReference,
    channel: i.channel, tier: i.tier, pay: i.pay, lines: i.lines, shownTotalKobo: i.shownTotalKobo, status: "waiting" as const,
  };
  // Customer details are kept only for a credit sale, the same privacy rule as drafts.
  return i.pay === "credit" ? { ...base, custName: i.custName!.trim(), custPhone: i.custPhone!.trim() } : base;
}

export const countWaiting = (q: QueuedSale[]) => q.filter((s) => s.status === "waiting").length;
