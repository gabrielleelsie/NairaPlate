// Selar payment messages. Pure helpers shared by the receiver and its tests.

/** Largest message the receiver reads. */
export const SELAR_MAX_BYTES = 100_000;
/** How much of a message is kept in the audit line. */
export const SELAR_LOG_MAX_CHARS = 8_000;
/** The shared secret must be at least this long to be accepted from the database. */
export const SELAR_SECRET_MIN_CHARS = 24;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The secret saved in the database, or null when it is missing or too short to trust. */
export function secretFromSetting(value: unknown): string | null {
  const s = (value as { secret?: unknown } | null | undefined)?.secret;
  return typeof s === "string" && s.length >= SELAR_SECRET_MIN_CHARS ? s : null;
}

/** True only when a secret is set and the one sent with the message matches it exactly. */
export function tokenMatches(sent: string | null | undefined, secret: string | null): boolean {
  if (!secret || !sent) return false;
  return timingSafeEqual(sent, secret);
}

export type ParsedMessage = { format: "json" | "form"; fields: Record<string, unknown> } | { format: "unreadable"; fields: null };

/** Reads a message sent as JSON or as an ordinary form body. Anything else is "unreadable" (it is still logged as text). */
export function parseMessage(raw: string, contentType: string | null | undefined): ParsedMessage {
  const type = (contentType ?? "").toLowerCase();
  const trimmed = raw.trim();
  if (type.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const v: unknown = JSON.parse(trimmed);
      if (v && typeof v === "object" && !Array.isArray(v)) return { format: "json", fields: v as Record<string, unknown> };
    } catch {
      /* fall through */
    }
    return { format: "unreadable", fields: null };
  }
  if (type.includes("x-www-form-urlencoded") || /^[^=\s]+=/.test(trimmed)) {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(trimmed)) fields[k] = v;
    return { format: "form", fields };
  }
  return { format: "unreadable", fields: null };
}

/** The audit line for a received message: its format, its field names and the message text cut to a safe length. */
export function logLine(raw: string, parsed: ParsedMessage): string {
  const names = parsed.fields ? Object.keys(parsed.fields).slice(0, 60).join(", ") : "none";
  const cut = raw.length > SELAR_LOG_MAX_CHARS ? raw.slice(0, SELAR_LOG_MAX_CHARS) + " [cut]" : raw;
  return `Format: ${parsed.format}. Fields: ${names}. Message: ${cut}`;
}

// ---------- stage 2: reading the fields of a payment message ----------
// Selar's real field names are not known yet, so each field is looked for under several likely names. Anything not found is left empty.
// Nothing here activates anyone: every staged payment waits for a platform admin, who sees the whole message.

export type SelarPayment = {
  orderRef: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  productName: string | null;
  amountKobo: number | null;
  currency: string | null;
  paidAt: string | null;
};

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first non-empty text found under any of the given names (names compared without case, spaces or punctuation). */
function pick(fields: Record<string, unknown>, names: string[]): string | null {
  const wanted = names.map(norm);
  for (const [k, v] of Object.entries(fields)) {
    if (!wanted.includes(norm(k))) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** "NGN 4,991.00", "₦4,991", 4991 or "4991.5" in naira to whole kobo. Null when it is not a plain amount. */
export function nairaToKobo(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/(ngn|naira|₦)/gi, "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(kobo) ? kobo : null;
}

export function extractPayment(fields: Record<string, unknown>): SelarPayment {
  const amountText = pick(fields, ["amount_paid", "amountpaid", "amount", "total", "price", "total_amount"]);
  const currencyFromAmount = amountText ? (amountText.match(/\b([A-Za-z]{3})\b/)?.[1] ?? (amountText.includes("₦") ? "NGN" : null)) : null;
  return {
    orderRef: pick(fields, ["order_id", "orderid", "order_ref", "order_reference", "reference", "transaction_reference", "transaction_id", "sale_id", "id"]),
    buyerName: pick(fields, ["customer_name", "buyer_name", "name", "full_name"]),
    buyerEmail: pick(fields, ["customer_email", "buyer_email", "email"]),
    productName: pick(fields, ["product_name", "product", "product_title", "item", "title"]),
    amountKobo: nairaToKobo(amountText),
    currency: (pick(fields, ["currency"]) ?? currencyFromAmount)?.toUpperCase() ?? null,
    paidAt: pick(fields, ["purchase_date", "paid_at", "date", "created_at", "date_paid"]),
  };
}

/** True for the setup service (its name contains "setup"). */
export const isSetupProduct = (productName: string | null): boolean => /\bsetup\b|set-up|set up/i.test(productName ?? "");

/** An email address tidied for matching. Null when it is not a plain address. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200 ? e : null;
}

/** Escapes % and _ so an email can be matched exactly with ILIKE. */
export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => "\\" + c);

/** A stable stand-in reference when the message carries none, so an identical re-send is still recognised as a duplicate. */
export async function fallbackRef(raw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return "raw:" + Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
