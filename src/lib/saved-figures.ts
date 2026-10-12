// After S4 the database works out batch and wastage costs itself and ignores a different figure from the screen.
// These helpers pick the figure to show (the saved one) and the plain-English notice for when it differs.

/** The database ignores a cost within this many kobo of its own figure. The notice follows the same rule. */
export const COST_TOLERANCE_KOBO = 1;

/** A number from the database, or null when it is missing or not a number. */
export function savedKobo(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Math.round(Number(value));
  return null;
}

/** The cost to show: the saved one when the database gave it, else the screen's own figure. */
export const costToShow = (saved: unknown, screenKobo: number): number =>
  savedKobo(saved) ?? screenKobo;

/** True when the saved cost differs from the screen's by more than the tolerance. */
export const costDiffers = (saved: unknown, screenKobo: number): boolean => {
  const s = savedKobo(saved);
  return s !== null && Math.abs(s - screenKobo) > COST_TOLERANCE_KOBO;
};

/** The notice for a differing cost, or null when there is nothing to say. `fmt` formats kobo as naira. */
export function differingCostNotice(
  saved: unknown,
  screenKobo: number,
  fmt: (kobo: number) => string,
): string | null {
  if (!costDiffers(saved, screenKobo)) return null;
  const s = savedKobo(saved) as number;
  return `The database used today's ingredient prices and saved ${fmt(s)}. Your screen showed ${fmt(screenKobo)}, so its prices may be out of date. Refresh the page.`;
}
