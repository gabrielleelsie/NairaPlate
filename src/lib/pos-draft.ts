// The Till's half-entered sale, as kept on the device. Pure helpers, tested in pos-draft.test.ts.
import type { PayChoice } from "./payment-ui";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type DraftLine = { recipe_id: string; quantity: number };

export type PosDraft = {
  key: string;
  clientSaleId: string;
  lines: DraftLine[];
  channel: string;
  aggName: string;
  tier: string;
  pay: PayChoice;
  cashN: string;
  trN: string;
  /** Only present when pay === "credit". */
  custName?: string;
  custPhone?: string;
  /** "editing" or "uncertain" (sent, but we could not confirm it saved). */
  state: "editing" | "uncertain";
  updatedAtUtc: string;
};

/** Removes customer details unless this is a credit sale. Agreed privacy rule. */
export function sanitizeDraft(d: PosDraft): PosDraft {
  if (d.pay === "credit") return d;
  const { custName: _n, custPhone: _p, ...rest } = d;
  return rest;
}

export function isDraftEmpty(d: Pick<PosDraft, "lines" | "state">): boolean {
  return d.state === "editing" && d.lines.length === 0;
}

export function isDraftExpired(d: Pick<PosDraft, "updatedAtUtc">, nowMs: number): boolean {
  return nowMs - Date.parse(d.updatedAtUtc) > DRAFT_TTL_MS;
}

/** "Demo Kitchen" business id "demo-kitchen" -> "DK". */
export function businessCode(businessId: string): string {
  const parts = businessId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const code = parts.map((p) => p[0]!.toUpperCase()).join("");
  return code || "NP";
}

/** "Till 1 — Counter" -> "T1"; anything without a number -> first letters. */
export function tillCode(label: string): string {
  const t = label.trim();
  if (!t) return "T";
  const num = t.match(/\d+/)?.[0];
  if (num) return `T${num}`;
  return t.split(/\s+/).map((w) => w[0]!.toUpperCase()).join("").slice(0, 3);
}

/** DK-20261004-T1-007. Counted per device per day; not unique across devices until Phase 1. */
export function paperReference(businessId: string, lagosDateKey: string, tillLabel: string, seq: number): string {
  return `${businessCode(businessId)}-${lagosDateKey.replaceAll("-", "")}-${tillCode(tillLabel)}-${String(seq).padStart(3, "0")}`;
}

export function newClientSaleId(): string {
  return crypto.randomUUID();
}
