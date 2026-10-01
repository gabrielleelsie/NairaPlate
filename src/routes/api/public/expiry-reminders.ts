// expiry-reminders: called every hour by the database scheduler (pg_cron + pg_net in the external Supabase
// project), never by a browser. Emails the owners of a business when its plan (or free trial) is a set number
// of days from ending, or has just ended. The days, the hour and the wording come from the platform admin's
// Settings tab, and the whole thing is OFF until an admin switches it on.
//
// Auth: "Authorization: Bearer <DAILY_SUMMARY_SECRET>" (the same secret the daily summary uses).
// Body (optional): { dry_run?: boolean, business_id?: string }
//   dry_run -> works out who is due and returns it. Sends nothing, records nothing, works even while switched off.
// Rules:
//   - it only sends in the hour chosen in Settings (Nigeria time), so the hourly schedule sends once a day;
//   - only approved businesses on a trial or a paid plan, on an exact day offset (a missed day is not made up);
//   - only owners and supa admins who are active and have an email address;
//   - at most one email per business, plan period, kind and day: subscription_reminder_log is claimed before sending.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { lagosDateKey } from "@/lib/lagos-time";
import { sendExpiryReminderEmail, logEmailUndelivered } from "@/lib/email.server";
import { sameHex } from "@/lib/daily-summary.server";
import { dueReminder, mergeReminders, renderReminder } from "@/lib/reminders";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const Body = z.object({ dry_run: z.boolean().optional(), business_id: z.string().trim().min(1).max(100).optional() });

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Outcome = { business_id: string; kind?: string; offset?: number; result: string; recipients?: number; sent?: number };

export const Route = createFileRoute("/api/public/expiry-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["DAILY_SUMMARY_SECRET"];
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!secret || !serviceKey) return json({ error: "Server is not configured." }, 500);
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token || !sameHex(token, secret)) return json({ error: "Unauthorized" }, 401);

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "Invalid request body." }, 400);
        const { dry_run = false, business_id: only } = parsed.data;

        const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const now = new Date();

        const { data: row, error: sErr } = await admin.from("platform_settings").select("value").eq("key", "reminders").maybeSingle();
        if (sErr) return json({ error: "Could not read the reminder settings." }, 500);
        const settings = mergeReminders(row?.value);

        const lagosHour = Number(now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" })) % 24;
        if (!dry_run) {
          if (!settings.enabled) return json({ skipped: "switched_off", businesses: 0, outcomes: [] });
          if (lagosHour !== settings.send_hour) return json({ skipped: "not_send_hour", lagos_hour: lagosHour, send_hour: settings.send_hour, businesses: 0, outcomes: [] });
        }

        let q = admin.from("businesses").select("id, name, status, plan, access_ends_at").eq("status", "approved").neq("id", "platform");
        if (only) q = q.eq("id", only);
        const { data: businesses, error: bErr } = await q;
        if (bErr) return json({ error: "Could not read businesses." }, 500);

        const outcomes: Outcome[] = [];
        for (const b of businesses ?? []) {
          const due = dueReminder(b as { status: string; plan: string | null; access_ends_at: string | null }, now, settings);
          if (!due) continue;
          const id = b.id as string;
          const name = b.name as string;
          const base = { business_id: id, kind: due.kind, offset: due.offset };

          const { data: owners } = await admin.from("staff_users").select("email").eq("business_id", id)
            .in("role", ["owner", "supa_admin"]).eq("is_active", true).not("email", "is", null);
          const recipients = [...new Set((owners ?? []).map((o) => String(o.email ?? "").trim()).filter((e) => e.includes("@")))];
          if (recipients.length === 0) { outcomes.push({ ...base, result: "no_owner_email" }); continue; }

          if (dry_run) { outcomes.push({ ...base, result: "would_send", recipients: recipients.length }); continue; }

          // Claim this reminder first, so a retried or overlapping run can never send it twice.
          const { error: claimErr } = await admin.from("subscription_reminder_log").insert({
            business_id: id, period_end: due.ends_at, kind: due.kind, offset_days: due.offset, recipients: recipients.length, sent: 0,
          });
          if (claimErr) { outcomes.push({ ...base, result: "already_sent" }); continue; }

          const mail = renderReminder(settings, due.kind, { name, plan: b.plan as string | null }, due);
          let sent = 0;
          let lastReason = "";
          for (const to of recipients) {
            const r = await sendExpiryReminderEmail(to, mail.subject, mail.html);
            if (r.sent) sent++; else lastReason = r.reason ?? "unknown";
          }
          await admin.from("subscription_reminder_log").update({ sent })
            .eq("business_id", id).eq("period_end", due.ends_at).eq("kind", due.kind).eq("offset_days", due.offset);
          if (sent < recipients.length) {
            await logEmailUndelivered(admin, {
              businessId: id, kind: "Expiry reminder",
              subjectOf: `${name} (${lagosDateKey(now)}, ${due.kind}), ${recipients.length - sent} of ${recipients.length} not delivered`, reason: lastReason,
            });
          }
          outcomes.push({ ...base, result: sent > 0 ? "sent" : "send_failed", recipients: recipients.length, sent });
        }
        return json({ dry_run, lagos_hour: lagosHour, enabled: settings.enabled, businesses: outcomes.length, outcomes });
      },
    },
  },
});
