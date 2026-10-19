// Small helpers for matching an owner's email. (The Selar message receiver that used to live here has been removed.)

/** An email address tidied for matching. Null when it is not a plain address. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200 ? e : null;
}

/** Escapes % and _ so an email can be matched exactly with ILIKE. */
export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => "\\" + c);
