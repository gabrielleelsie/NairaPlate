// Server-only email dispatch through the Resend connector gateway.
// Never throws: a failed send must not roll back or block the action that triggered it.
// When email is not configured, the full payload is written to the audit trail instead,
// so a security alert is never silently lost.
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM = "NairaPlate <onboarding@resend.dev>";

export type SendResult = { sent: boolean; reason?: string };

async function send(to: string, subject: string, html: string): Promise<SendResult> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) return { sent: false, reason: "email not configured" };
  try {
    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`resend send failed [${res.status}]: ${body}`);
      return { sent: false, reason: `provider error ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("resend send failed", err);
    return { sent: false, reason: "network error" };
  }
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
