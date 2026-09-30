// Server-only email dispatch, sent directly through the owner's Resend account (plain fetch, Worker-safe).
// Never throws: a failed send must not roll back or block the action that triggered it.
// When email is not configured, the full payload is written to the audit trail instead,
// so a security alert is never silently lost.
// Never logs the API key or email bodies.
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

export type SendResult = { sent: boolean; reason?: string; id?: string };

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Reason wording is fixed, so audit rows can be searched consistently. Never contains keys or bodies. */
export const NO_ADMIN_EMAIL_REASON = "no platform administrator has an email address";

async function send(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = process.env["RESEND_DIRECT_API_KEY"];
  const from = process.env["EMAIL_FROM"];
  if (!apiKey || !from) {
    const missing = [!apiKey ? "RESEND_DIRECT_API_KEY" : "", !from ? "EMAIL_FROM" : ""].filter(Boolean).join(", ");
    return { sent: false, reason: `email not configured, missing: ${missing}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [to], subject, html, text: htmlToText(html) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = (await res.text()).slice(0, 300);
      let msg = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string; error?: string };
        msg = parsed.message ?? parsed.error ?? raw;
      } catch { /* keep the raw text */ }
      console.error(`resend send failed [${res.status}]`);
      return { sent: false, reason: `Resend rejected the request: ${res.status} ${msg}`.trim() };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return data.id ? { sent: true, id: data.id } : { sent: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error(aborted ? "resend send timed out" : "resend send failed: network error");
    return { sent: false, reason: "email request failed or timed out" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes one audit row per undelivered email, so a skip or failure is never invisible.
 * Never records the API key, the email body, a recipient's message text or any PIN.
 * Platform-wide emails use the same "platform" business_id that security alerts use.
 */
export async function logEmailUndelivered(
  admin: SupabaseClient,
  opts: { businessId: string; kind: string; subjectOf: string; reason: string; actorId?: string | null },
): Promise<void> {
  await writeAudit(admin, {
    business_id: opts.businessId,
    actor_id: opts.actorId ?? null,
    actor_role: "platform_admin",
    action: "email_undelivered",
    entity_type: "email",
    details: `${opts.kind} — ${opts.subjectOf} — ${opts.reason}`,
  });
}

function shell(title: string, lines: string[], tone: "alert" | "info") {
  const accent = tone === "alert" ? "#B42318" : "#0078D4";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6f8;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(11,34,57,.08)">
      <div style="background:#0B2239;color:#fff;padding:18px 24px;font-size:18px;font-weight:600">NairaPlate</div>
      <div style="padding:24px">
        <h1 style="margin:0 0 14px;font-size:17px;color:${accent}">${title}</h1>
        ${lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#0B2239">${l}</p>`).join("")}
        <p style="margin:20px 0 0;font-size:12px;color:#667">Sent automatically by NairaPlate. Every action above is recorded in the permanent audit trail.</p>
      </div>
    </div>
  </div>`;
}

/** Alerts the platform admin about a high-risk support action they (or another admin) just took. */
export async function sendSecurityAlert(
  admin: SupabaseClient,
  opts: {
    to: string;
    adminName: string;
    action: string;
    businessName: string;
    businessId: string;
    detail: string;
    origin: string | null;
  },
): Promise<SendResult> {
  const subject = `Security alert: ${opts.action} — ${opts.businessName}`;
  const html = shell(
    `High-risk action: ${opts.action}`,
    [
      `<strong>${opts.adminName}</strong> performed <strong>${opts.action}</strong>.`,
      `Business: <strong>${opts.businessName}</strong> (${opts.businessId})`,
      opts.detail,
      `Time: ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} (Lagos)`,
      opts.origin ? `Origin: ${opts.origin}` : "",
    ].filter(Boolean),
    "alert",
  );
  const result = await send(opts.to, subject, html);
  if (!result.sent) {
    await writeAudit(admin, {
      business_id: opts.businessId,
      actor_id: null,
      actor_role: "platform_admin",
      action: "security_alert_undelivered",
      entity_type: "email",
      details: `${subject} — could not be emailed (${result.reason}). ${opts.detail}`,
    });
  }
  return result;
}

/** Tells the platform admin a new kitchen is waiting for review. */
export async function sendSignupAlert(to: string, businessName: string, businessId: string, ownerName: string) {
  return send(
    to,
    `New business awaiting approval: ${businessName}`,
    shell("A new kitchen has registered", [
      `<strong>${businessName}</strong> (${businessId}) signed up.`,
      `Owner: ${ownerName}`,
      "Open the platform console to approve or reject it.",
    ], "info"),
  );
}

/** Tells a business owner their account status changed. */
export async function sendOwnerStatusEmail(
  to: string,
  businessName: string,
  status: "approved" | "rejected" | "suspended",
  reason: string | null,
) {
  const titles: Record<typeof status, string> = {
    approved: "Your NairaPlate account is approved",
    rejected: "Your NairaPlate registration was not approved",
    suspended: "Your NairaPlate account has been suspended",
  };
  const bodies: Record<typeof status, string[]> = {
    approved: [`<strong>${businessName}</strong> is approved. You and your staff can sign in now.`],
    rejected: [`<strong>${businessName}</strong> was not approved.`, reason ? `Reason: ${reason}` : ""],
    suspended: [
      `<strong>${businessName}</strong> has been suspended, so nobody at your business can sign in right now.`,
      reason ? `Reason: ${reason}` : "",
      "Reply to this email to sort it out with NairaPlate support.",
    ],
  };
  return send(to, titles[status], shell(titles[status], bodies[status].filter(Boolean), status === "approved" ? "info" : "alert"));
}

/** Forwards a message from the public contact page to the platform admin inbox. */
export async function sendContactMessage(
  to: string,
  msg: { name: string; businessName: string | null; contact: string; message: string },
) {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
  return send(
    to,
    `Website enquiry from ${msg.name}`,
    shell("New message from the NairaPlate website", [
      `From: <strong>${esc(msg.name)}</strong>`,
      msg.businessName ? `Business: ${esc(msg.businessName)}` : "",
      `Reach them on: <strong>${esc(msg.contact)}</strong>`,
      `Message:<br>${esc(msg.message).replace(/\n/g, "<br>")}`,
    ].filter(Boolean), "info"),
  );
}

/** Sends one owner's daily summary. The HTML is built by daily-summary.server.ts. */
export async function sendDailySummaryEmail(to: string, subject: string, html: string): Promise<SendResult> {
  return send(to, subject, html);
}

/** Tells the owner a payment was recorded and when their access now ends. */
export async function sendPaymentConfirmation(
  to: string, businessName: string, planLabel: string, amountText: string, reference: string, endsText: string,
): Promise<SendResult> {
  const html = shell("Payment received — thank you", [
    `We have recorded your payment for <strong>${businessName}</strong>.`,
    `Plan: <strong>${planLabel}</strong> · Amount: <strong>${amountText}</strong> · Reference: ${reference}`,
    `Your access now runs until <strong>${endsText}</strong> (11:59 pm Lagos time).`,
  ], "info");
  return send(to, `NairaPlate payment received — access until ${endsText}`, html);
}
