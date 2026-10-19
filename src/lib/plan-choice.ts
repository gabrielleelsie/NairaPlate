// Plan type + term: the price for a choice, and the plan an amount paid points to. Pure, shared by the plan page, the Selar receiver and the console.
import { PLAN_MODES, PLAN_NAME, formatPrice, type Prices } from "@/lib/platform-settings";
import type { OperatingMode } from "@/lib/features";

export const PLAN_TERMS = ["monthly", "quarterly", "yearly"] as const;
export type PlanTerm = (typeof PLAN_TERMS)[number];
export const TERM_LABEL: Record<PlanTerm, string> = { monthly: "Monthly", quarterly: "3 months", yearly: "12 months" };

export type PlanPick = { mode: OperatingMode; term: PlanTerm };

export const isMode = (v: unknown): v is OperatingMode => typeof v === "string" && (PLAN_MODES as string[]).includes(v);
export const isTerm = (v: unknown): v is PlanTerm => typeof v === "string" && (PLAN_TERMS as readonly string[]).includes(v);

/** The price of a plan type and term, in kobo. Null when the price list has none. */
export function amountFor(prices: Prices | null | undefined, mode: OperatingMode, term: PlanTerm): number | null {
  const p = prices?.plans?.[mode];
  const kobo = p ? p[`${term}_kobo` as const] : null;
  return kobo !== null && kobo !== undefined && kobo > 0 ? kobo : null;
}

/** The plan type and term whose price equals the amount paid. Null when none matches, or when more than one does (it cannot tell). */
export function planFromAmount(prices: Prices | null | undefined, kobo: number | null | undefined): PlanPick | null {
  if (!kobo || kobo <= 0) return null;
  const hits: PlanPick[] = [];
  for (const mode of PLAN_MODES) for (const term of PLAN_TERMS) if (amountFor(prices, mode, term) === kobo) hits.push({ mode, term });
  return hits.length === 1 ? (hits[0] as PlanPick) : null;
}

export const planText = (p: PlanPick): string => `${PLAN_NAME[p.mode]}, ${TERM_LABEL[p.term].toLowerCase()}`;

/** Plain-English differences between what was paid, the kitchen's current plan type and what the owner chose. Empty when all agree. */
export function planDifferences(args: { paid: PlanPick | null; kitchenMode: OperatingMode | null; chosen: PlanPick | null }): string[] {
  const { paid, kitchenMode, chosen } = args;
  const out: string[] = [];
  if (!paid) return ["The amount paid matches no plan on the price list."];
  if (kitchenMode && kitchenMode !== paid.mode) out.push(`Paid for ${planText(paid)}. This kitchen is on ${PLAN_NAME[kitchenMode]}.`);
  if (chosen && (chosen.mode !== paid.mode || chosen.term !== paid.term)) out.push(`The owner chose ${planText(chosen)} on the plan page, but paid for ${planText(paid)}.`);
  return out;
}

export const choiceLine = (prices: Prices | null | undefined, p: PlanPick): string => {
  const amt = formatPrice(amountFor(prices, p.mode, p.term));
  return `${planText(p)}${amt ? `, ${amt}` : ""}`;
};

/**
 * A store that comes through the payment route never gets a trial. The database starts a trial only when a store goes from waiting to approved
 * with an empty access end date, so such a store is saved with an end date that has already passed. It then stays on the Subscribe screen until
 * its first payment is recorded, which sets the plan and the new end date.
 */
export const noTrialEndsAt = (now: number = Date.now()): string => new Date(now - 1000).toISOString();

/** True when a waiting store with an empty end date has a Selar payment waiting: it must be given its past end date before it is approved. */
export function needsNoTrialDate(a: { status: string; accessEndsAt: string | null; hasWaitingSelarPayment: boolean }): boolean {
  return a.status === "pending" && a.accessEndsAt === null && a.hasWaitingSelarPayment;
}
