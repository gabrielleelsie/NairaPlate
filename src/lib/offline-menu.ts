// The menu (dish names and today's prices) kept on the device so the Till can start with no internet.
// Pure helpers, tested in offline-menu.test.ts. Only dish names and prices are stored: nothing secret.

export type MenuItem = { id: string; name: string; selling_price_kobo: number };
export type MenuCache = { businessId: string; savedAtUtc: string; recipes: MenuItem[] };

/** A saved menu, if it is well formed and belongs to this business. Anything else is ignored, never trusted. */
export function readMenuCache(raw: unknown, businessId: string): MenuCache | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<MenuCache>;
  if (c.businessId !== businessId || typeof c.savedAtUtc !== "string" || Number.isNaN(Date.parse(c.savedAtUtc))) return null;
  if (!Array.isArray(c.recipes)) return null;
  const recipes: MenuItem[] = [];
  for (const r of c.recipes as unknown[]) {
    const m = r as Partial<MenuItem> | null;
    if (!m || typeof m.id !== "string" || typeof m.name !== "string") return null;
    const price = Number(m.selling_price_kobo);
    if (!Number.isFinite(price) || price < 0) return null;
    recipes.push({ id: m.id, name: m.name, selling_price_kobo: price });
  }
  return { businessId, savedAtUtc: c.savedAtUtc, recipes };
}
