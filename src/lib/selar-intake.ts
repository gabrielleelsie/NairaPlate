// Selar payment messages (first stage: logging only). Pure helpers shared by the receiver and its tests.

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
  return `Test mode, nothing was recorded or activated. Format: ${parsed.format}. Fields: ${names}. Message: ${cut}`;
}
