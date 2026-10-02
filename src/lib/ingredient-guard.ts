// Ingredients: the rules the database enforces on stock, price, unit and deletes, in the words the screen uses.
// The database is the real lock; this is only so the screen can say why a field is locked before anyone tries.
export const UNIT_LOCK_MESSAGE = "This ingredient already has stock or purchase history, so its unit cannot be changed. Add a new ingredient instead.";

/** True when this ingredient's unit must not be edited. An ingredient we have no answer for is treated as unlocked; the database still refuses. */
export const unitLocked = (ingredientId: string | null | undefined, withHistory: ReadonlySet<string>): boolean => !!ingredientId && withHistory.has(ingredientId);

/** Reads the ids the database returns (a list of uuids, or null). */
export function historyIds(rows: unknown): Set<string> {
  return new Set((Array.isArray(rows) ? rows : []).map((r) => String(r)));
}

/** Shows the database's own sentence for the guard rules, and a plain fallback for anything else. */
export function saveErrorText(message: string | null | undefined, fallback: string): string {
  const m = message ?? "";
  return /history|only be changed by logging/i.test(m) ? m : fallback;
}
