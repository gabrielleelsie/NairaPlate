// Nigeria time helpers. Africa/Lagos is WAT, UTC+1 all year with no daylight saving,
// so a fixed one-hour offset is exact. A "day" everywhere in NairaPlate runs from
// midnight to midnight Nigeria time, not UTC.

export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Nigeria calendar date of an instant, as YYYY-MM-DD. */
export function lagosDateKey(d: Date): string {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant Nigeria's day containing `d` began (midnight WAT, i.e. 23:00 UTC the day before). */
export function lagosDayStart(d: Date): Date {
  return new Date(Date.parse(`${lagosDateKey(d)}T00:00:00Z`) - LAGOS_OFFSET_MS);
}

/** The last `days` Nigeria days, ending at the end of today (inclusive from, exclusive to). */
export function lagosLastDays(days: number, now = new Date()): { from: Date; to: Date } {
  const to = new Date(lagosDayStart(now).getTime() + DAY_MS);
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

/** Shifts an instant so its UTC fields read as Nigeria wall-clock time (for calendar arithmetic). */
export function toLagosWallClock(d: Date): Date {
  return new Date(d.getTime() + LAGOS_OFFSET_MS);
}

/** Reverses toLagosWallClock: a UTC-field wall-clock time in Nigeria back to the real instant. */
export function fromLagosWallClock(d: Date): Date {
  return new Date(d.getTime() - LAGOS_OFFSET_MS);
}
