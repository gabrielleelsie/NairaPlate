// Subscription date rules. Every date is Nigeria time (Africa/Lagos, WAT, UTC+1, no DST).
// Access ends at 23:59:59 WAT on the last day of the period. No grace, no auto-renewal.
//
// Month rule: a paid period that starts on day S ends on (S + N calendar months) − 1 day,
// at 23:59:59 WAT. When S + N months overflows the month (e.g. 31 Jan + 1 month) the date
// caps at that month's last day, exactly like Postgres `date + interval 'N months'`.
// Early renewal stacks: if access is still running, the new period starts the day after
// the current end; otherwise it starts today.
import { DAY_MS, fromLagosWallClock, lagosDateKey, lagosDayStart, toLagosWallClock } from "@/lib/lagos-time";

export type PaidPlan = "monthly" | "quarterly" | "yearly";
export const PLAN_MONTHS: Record<PaidPlan, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const PLAN_LABEL: Record<string, string> = { trial: "Free trial", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

const END_OF_DAY_MS = DAY_MS - 1000; // 23:59:59

function endOfLagosDay(y: number, m: number, d: number): Date {
  return fromLagosWallClock(new Date(Date.UTC(y, m, d) + END_OF_DAY_MS));
}

/** Trial end: 23:59:59 WAT on day 7, where the approval day is day 1. */
export function trialEnd(approvedAt: Date): Date {
  const w = toLagosWallClock(approvedAt);
  return endOfLagosDay(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + 6);
}

/** The period a new payment buys. */
export function termFor(currentEnd: Date | null, now: Date, plan: PaidPlan): { start: Date; end: Date } {
  const start = currentEnd && currentEnd.getTime() > now.getTime()
    ? lagosDayStart(new Date(currentEnd.getTime() + 1000))
    : lagosDayStart(now);
  const w = toLagosWallClock(start);
  const total = w.getUTCMonth() + PLAN_MONTHS[plan];
  const y = w.getUTCFullYear() + Math.floor(total / 12);
  const m = total % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(w.getUTCDate(), lastDay);
  return { start, end: endOfLagosDay(y, m, d - 1) };
}

export type AccessState =
  | { kind: "active"; daysLeft: number; endsAt: Date; plan: string | null }
  | { kind: "expired"; endsAt: Date | null; plan: string | null }
  | { kind: "pending" | "suspended" | "rejected" };

/** daysLeft counts Nigeria calendar days including today (ends today = 1). */
export function accessState(b: { status: string; access_ends_at: string | null; plan?: string | null }, now = new Date()): AccessState {
  if (b.status === "pending" || b.status === "suspended" || b.status === "rejected") return { kind: b.status };
  const endsAt = b.access_ends_at ? new Date(b.access_ends_at) : null;
  const plan = b.plan ?? null;
  if (!endsAt || endsAt.getTime() <= now.getTime()) return { kind: "expired", endsAt, plan };
  const daysLeft = Math.round((Date.parse(lagosDateKey(endsAt)) - Date.parse(lagosDateKey(now))) / DAY_MS) + 1;
  return { kind: "active", daysLeft, endsAt, plan };
}

export function formatLagosDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}
