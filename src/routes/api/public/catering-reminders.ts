// catering-reminders: called by the database scheduler, never by a browser. Emails each business's owners the catering orders
// that are due: "morning" = orders today (about 6:30 am Nigeria time), "evening" = orders tomorrow (about 6:30 pm).
//
// Auth: "Authorization: Bearer <DAILY_SUMMARY_SECRET>". Body: { kind: "morning" | "evening", dry_run?: boolean, business_id?: string }
// Rules:
//   - dates are Nigeria time (WAT);
//   - only approved businesses with daily_summary_enabled = true (the same switch as the daily summary);
//   - only days with at least one order (no empty emails);
//   - only owners and supa admins who are active and have an email address;
//   - at most one email per business, kind and day: catering_reminder_log is claimed before sending.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { lagosDateKey } from "@/lib/lagos-time";
import { sendDailySummaryEmail, logEmailUndelivered } from "@/lib/email.server";
import { sameHex, unsubscribeSignature } from "@/lib/daily-summary.server";
import { reminderHtml, reminderSubject, type ReminderOrder } from "@/lib/catering-reminders.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const Body = z.object({ kind: z.enum(["morning", "evening"]), dry_run: z.boolean().optional(), business_id: z.string().trim().min(1).max(100).optional() });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Outcome = { business_id: string; result: string; orders?: number; recipients?: number; sent?: number };

export const Route = createFileRoute("/api/public/catering-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["DAILY_SUMMARY_SECRET"];
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!secret || !serviceKey) return json({ error: "Server is not configured." }, 500);
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token || !sameHex(token, secret)) return json({ error: "Unauthorized" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid request body." }, 400);
        const { kind, dry_run = false, business_id: only } = parsed.data;

        const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const origin = new URL(request.url).origin;
        const now = new Date();
        const today = lagosDateKey(now);
        const eventDate = kind === "morning" ? today : lagosDateKey(new Date(now.getTime() + 86_400_000));

        let q = admin.from("businesses").select("id, name").eq("status", "approved").eq("daily_summary_enabled", true);
        if (only) q = q.eq("id", only);
        const { data: businesses, error: bErr } = await q;
        if (bErr) return json({ error: "Could not read businesses." }, 500);

        const { data: featureRows } = await admin.from("business_features").select("business_id").eq("feature", "catering").eq("enabled", true);
        const cateringOn = new Set((featureRows ?? []).map((r) => r.business_id as string));

        const { data: done } = await admin.from("catering_reminder_log").select("business_id").eq("kind", kind).eq("reminder_date", today);
        const already = new Set((done ?? []).map((r) => r.business_id as string));

        const outcomes: Outcome[] = [];
        for (const b of businesses ?? []) {
          const id = b.id as string, name = b.name as string;
          if (!cateringOn.has(id)) continue; // catering is not switched on for this business: no email, and not listed
          if (already.has(id)) { outcomes.push({ business_id: id, result: "already_sent" }); continue; }

          const { data: rows } = await admin.from("catering_deposits")
            .select("event_time, customer_name, phone, items_summary, total_contract_kobo, deposit_kobo, additional_payments_kobo, settled")
            .eq("business_id", id).eq("event_date", eventDate).eq("status", "confirmed");
          const orders: ReminderOrder[] = (rows ?? []).map((r) => ({
            event_time: (r.event_time as string | null) ?? null, customer_name: String(r.customer_name ?? ""), phone: (r.phone as string | null) ?? null,
            items_summary: (r.items_summary as string | null) ?? null, total_contract_kobo: Number(r.total_contract_kobo ?? 0),
            deposit_kobo: Number(r.deposit_kobo ?? 0), additional_payments_kobo: Number(r.additional_payments_kobo ?? 0), settled: !!r.settled,
          }));
          if (orders.length === 0) { outcomes.push({ business_id: id, result: "no_orders" }); continue; }

          const { data: owners } = await admin.from("staff_users").select("email").eq("business_id", id).in("role", ["owner", "supa_admin"]).eq("is_active", true).not("email", "is", null);
          const recipients = [...new Set((owners ?? []).map((o) => String(o.email ?? "").trim()).filter((e) => e.includes("@")))];
          if (recipients.length === 0) { outcomes.push({ business_id: id, result: "no_owner_email", orders: orders.length }); continue; }
          if (dry_run) { outcomes.push({ business_id: id, result: "would_send", orders: orders.length, recipients: recipients.length }); continue; }

          const { error: claimErr } = await admin.from("catering_reminder_log").insert({ business_id: id, kind, reminder_date: today, recipients: recipients.length, sent: 0 });
          if (claimErr) { outcomes.push({ business_id: id, result: "already_sent" }); continue; }

          const sig = await unsubscribeSignature(secret, id);
          const html = reminderHtml({
            kind, businessName: name, eventDate, orders, catering_url: `${origin}/catering`,
            unsubscribe_url: `${origin}/api/public/summary-unsubscribe?b=${encodeURIComponent(id)}&s=${sig}`,
          });
          const subject = reminderSubject(kind, name, eventDate, orders.length);
          let sent = 0, lastReason = "";
          for (const to of recipients) {
            const r = await sendDailySummaryEmail(to, subject, html);
            if (r.sent) sent++; else lastReason = r.reason ?? "unknown";
          }
          await admin.from("catering_reminder_log").update({ sent }).eq("business_id", id).eq("kind", kind).eq("reminder_date", today);
          if (sent < recipients.length) {
            await logEmailUndelivered(admin, { businessId: id, kind: "Catering reminder", subjectOf: `${name} (${eventDate}), ${recipients.length - sent} of ${recipients.length} not delivered`, reason: lastReason });
          }
          outcomes.push({ business_id: id, result: sent > 0 ? "sent" : "send_failed", orders: orders.length, recipients: recipients.length, sent });
        }
        return json({ kind, event_date: eventDate, dry_run, businesses: outcomes.length, outcomes });
      },
    },
  },
});
