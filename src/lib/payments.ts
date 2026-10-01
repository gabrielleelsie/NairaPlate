// Automatic transfer confirmation: the parts that do not touch the network or the database, so they can be tested.
// Monnify (Moniepoint's collections product) is the first provider. Details below follow its public documentation as far as it
// could be read; anything not yet confirmed against a real sandbox call is marked "unconfirmed".
import { z } from "zod";

export type Provider = "monnify";
export type ProviderMode = "test" | "live";
export const MONNIFY_BASE: Record<ProviderMode, string> = { test: "https://sandbox.monnify.com", live: "https://api.monnify.com" };

export const PAYMENT_MODE_LABEL = { manual: "Typed in at the till (not checked)", cash_only: "Cash and credit only", automatic: "Transfers confirmed automatically" } as const;
export type PaymentMode = keyof typeof PAYMENT_MODE_LABEL;

export const ConnectBody = z.object({
  provider: z.literal("monnify"),
  status: z.enum(["test", "live"]),
  api_key: z.string().trim().min(8).max(200),
  secret_key: z.string().trim().min(8).max(200),
  contract_code: z.string().trim().min(3).max(60),
}).strict();

export const kobo = (naira: number): number => Math.round(naira * 100);

export function basicAuth(apiKey: string, secretKey: string): string {
  return "Basic " + btoa(`${apiKey}:${secretKey}`);
}

export async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Monnify signs the raw request body with HMAC-SHA512 keyed by the shop's secret key, sent in the "monnify-signature" header.
 *  (Unconfirmed against a live sandbox call: the first sandbox test settles it.) */
export async function verifyMonnifySignature(secretKey: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !secretKey) return false;
  return sameHex(await hmacSha512Hex(secretKey, rawBody), header.trim().toLowerCase());
}

export type ParsedPayment = { event_id: string; reference: string; amount_kobo: number };

/** Reads a Monnify "successful transaction" message. null when it is anything else (other event types, unpaid, malformed). */
export function parseMonnifyPayment(body: unknown): ParsedPayment | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { eventType?: unknown; eventData?: Record<string, unknown> };
  if (b.eventType !== "SUCCESSFUL_TRANSACTION") return null;
  const d = b.eventData;
  if (!d || typeof d !== "object") return null;
  if (d["paymentStatus"] !== "PAID") return null;
  const reference = typeof d["paymentReference"] === "string" ? d["paymentReference"] : "";
  const tx = typeof d["transactionReference"] === "string" ? d["transactionReference"] : "";
  const amount = typeof d["amountPaid"] === "number" ? d["amountPaid"] : typeof d["amountPaid"] === "string" ? Number(d["amountPaid"]) : NaN;
  if (!reference || !tx || !Number.isFinite(amount) || amount <= 0) return null;
  return { event_id: tx, reference, amount_kobo: kobo(amount) };
}

/** The reference only (used to find which shop a message belongs to before its signature can be checked). */
export function referenceOf(body: unknown): string | null {
  const d = (body as { eventData?: Record<string, unknown> } | null)?.eventData;
  const r = d && typeof d["paymentReference"] === "string" ? d["paymentReference"] : "";
  return /^NP[0-9A-F]{32}$/.test(r) ? r : null;
}

export type TransferAccount = { account_number: string; bank_name: string; account_name: string; expires_at: string | null };

/** Reads the one-time account out of a "pay with bank transfer" response. Tolerant of small shape differences. (Unconfirmed field names.) */
export function parseTransferAccount(resp: unknown, now = new Date()): TransferAccount | null {
  const body = (resp as { responseBody?: Record<string, unknown> } | null)?.responseBody;
  if (!body || typeof body !== "object") return null;
  const num = String(body["accountNumber"] ?? "").trim();
  if (!/^\d{6,12}$/.test(num)) return null;
  const secs = Number(body["accountDurationSeconds"]);
  const expires = typeof body["expiresOn"] === "string" ? String(body["expiresOn"]) : Number.isFinite(secs) && secs > 0 ? new Date(now.getTime() + secs * 1000).toISOString() : null;
  return { account_number: num, bank_name: String(body["bankName"] ?? "").trim(), account_name: String(body["accountName"] ?? "").trim(), expires_at: expires };
}

/** Did Monnify accept the keys? "rejected" is an answer from Monnify (wrong or expired keys). "unreachable" is a network problem or a Monnify outage, which is not the shop's fault. */
export type LoginResult = "ok" | "rejected" | "unreachable";
export function classifyLogin(httpStatus: number | null, body: unknown): LoginResult {
  if (httpStatus === null) return "unreachable";
  if (httpStatus >= 500) return "unreachable";
  const b = body as { requestSuccessful?: unknown; responseBody?: { accessToken?: unknown } } | null;
  if (httpStatus >= 200 && httpStatus < 300 && b?.requestSuccessful === true && typeof b.responseBody?.accessToken === "string") return "ok";
  return "rejected";
}

export const KEYS_ALERT_TYPE = "payment_keys";
export const KEYS_ALERT_MESSAGE = "Monnify did not accept this shop's keys, so transfer orders cannot get an account number. Open Payments & transfers and connect again with current keys.";
