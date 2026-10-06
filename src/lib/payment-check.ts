// Checks a recorded payment against the price list. Pure, so the server, the screen and the tests share one rule.
// The price list is the Plan prices an admin sets (per plan: monthly, 3 months, 12 months, setup).
import type { OperatingMode } from "@/lib/features";
import { PLAN_NAME, formatPrice, type PlanKey, type Prices } from "@/lib/platform-settings";

export const DIFFERENCE_REASON_MIN = 5;

export type Expected = { kobo: number; planKobo: number; setupKobo: number; text: string };

/** What the customer should pay: the price of their plan and period, plus the setup fee when this payment includes it.
 *  Null when it cannot be worked out (no profile chosen, or a price left blank), in which case nothing is checked. */
export function expectedPayment(prices: Prices | null | undefined, mode: OperatingMode | null | undefined, plan: PlanKey, includesSetup: boolean): Expected | null {
  const p = mode ? prices?.plans?.[mode] : null;
  if (!mode || !p) return null;
  const planKobo = p[`${plan}_kobo` as const];
  if (planKobo === null || planKobo <= 0) return null;
  let setupKobo = 0;
  if (includesSetup) {
    if (p.setup_kobo === null || p.setup_kobo <= 0) return null;
    setupKobo = p.setup_kobo;
  }
  const label = `${PLAN_NAME[mode]} ${plan === "quarterly" ? "3 months" : plan === "yearly" ? "12 months" : "monthly"} ${formatPrice(planKobo)}`;
  const text = includesSetup ? `${label} plus setup ${formatPrice(setupKobo)} = ${formatPrice(planKobo + setupKobo)}` : label;
  return { kobo: planKobo + setupKobo, planKobo, setupKobo, text };
}

export type AmountCheck = { ok: true; matches: boolean; reason: string | null } | { ok: false; error: string };

/** A payment that matches the price list goes straight through. A different amount needs a reason (a discount, a part payment). */
export function checkPaymentAmount(amountKobo: number, expected: Expected | null, reason: string | undefined): AmountCheck {
  if (!expected || amountKobo === expected.kobo) return { ok: true, matches: true, reason: null };
  const r = (reason ?? "").trim();
  if (r.length < DIFFERENCE_REASON_MIN) {
    return { ok: false, error: `The amount ${formatPrice(amountKobo)} does not match the price list (${expected.text}). If the customer really paid this amount, enter the reason (at least ${DIFFERENCE_REASON_MIN} characters).` };
  }
  return { ok: true, matches: false, reason: r };
}
