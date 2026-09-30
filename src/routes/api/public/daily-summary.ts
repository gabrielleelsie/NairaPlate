// daily-summary — called once each evening by the database scheduler (pg_cron + pg_net in the
// external Supabase project), never by a browser. Emails each approved business's owners the day's
// sales, food cost and profit, using exactly the same calculation as the owner dashboard.
//
// Auth: "Authorization: Bearer <DAILY_SUMMARY_SECRET>". The same secret signs the unsubscribe links.
// Body (optional): { dry_run?: boolean, business_id?: string }
//   dry_run  -> works everything out and returns it, but sends nothing and records nothing.
// Rules:
//   - a day is today in Nigeria time (WAT), from midnight up to the moment the job runs;
//   - only businesses with status "approved" and daily_summary_enabled = true;
//   - only days with at least one paid order (no empty emails);
//   - only owners and supa admins who are active and have an email address;
//   - at most one summary per business per day: daily_summary_log is claimed before sending.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { calculateBusinessPnl } from "@/lib/pnl";
import { lagosDateKey, lagosDayStart } from "@/lib/lagos-time";
import { sendDailySummaryEmail, logEmailUndelivered } from "@/lib/email.server";
import {
  sameHex,
  summaryHtml,
  summarySubject,
  unsubscribeSignature,
} from "@/lib/daily-summary.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const Body = z.object({
  dry_run: z.boolean().optional(),
  business_id: z.string().trim().min(1).max(100).optional(),
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

type Outcome = { business_id: string; result: string; recipients?: number; sent?: number };

export const Route = createFileRoute("/api/public/daily-summary")({
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
        const { dry_run = false, business_id: onlyBusiness } = parsed.data;

        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const origin = new URL(request.url).origin;
        const now = new Date();
        const summaryDate = lagosDateKey(now);
        const range = { from: lagosDayStart(now), to: now };
        const dateLabel = now.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Africa/Lagos",
        });
        const sentAtLabel = now.toLocaleTimeString("en-GB", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "Africa/Lagos",
        });

        let q = admin
          .from("businesses")
          .select("id, name")
          .eq("status", "approved")
          .eq("daily_summary_enabled", true);
        if (onlyBusiness) q = q.eq("id", onlyBusiness);
        const { data: businesses, error: bErr } = await q;
        if (bErr) return json({ error: "Could not read businesses." }, 500);

        const { data: done } = await admin
          .from("daily_summary_log")
          .select("business_id")
          .eq("summary_date", summaryDate);
        const alreadySent = new Set((done ?? []).map((r) => r.business_id as string));

        const outcomes: Outcome[] = [];
        for (const b of businesses ?? []) {
          const id = b.id as string;
          const name = b.name as string;
          if (alreadySent.has(id)) {
            outcomes.push({ business_id: id, result: "already_sent_today" });
            continue;
          }

          const { data: owners } = await admin
            .from("staff_users")
            .select("email")
            .eq("business_id", id)
            .in("role", ["owner", "supa_admin"])
            .eq("is_active", true)
            .not("email", "is", null);
          const recipients = [
            ...new Set(
              (owners ?? [])
                .map((o) => String(o.email ?? "").trim())
                .filter((e) => e.includes("@")),
            ),
          ];
          if (recipients.length === 0) {
            outcomes.push({ business_id: id, result: "no_owner_email" });
            continue;
          }

          let pnl;
          try {
            pnl = await calculateBusinessPnl(admin, id, range);
          } catch {
            outcomes.push({ business_id: id, result: "could_not_calculate" });
            continue;
          }
          if (pnl.paid_orders === 0) {
            outcomes.push({
              business_id: id,
              result: "no_sales_today",
              recipients: recipients.length,
            });
            continue;
          }

          if (dry_run) {
            outcomes.push({ business_id: id, result: "would_send", recipients: recipients.length });
            continue;
          }

          // Claim the day first, so a retried or overlapping run can never send twice.
          const { error: claimErr } = await admin
            .from("daily_summary_log")
            .insert({
              business_id: id,
              summary_date: summaryDate,
              recipients: recipients.length,
              sent: 0,
            });
          if (claimErr) {
            outcomes.push({ business_id: id, result: "already_sent_today" });
            continue;
          }

          const sig = await unsubscribeSignature(secret, id);
          const html = summaryHtml({
            businessName: name,
            dateLabel,
            sentAtLabel,
            pnl,
            dashboardUrl: `${origin}/dashboard`,
            unsubscribeUrl: `${origin}/api/public/summary-unsubscribe?b=${encodeURIComponent(id)}&s=${sig}`,
          });
          let sent = 0;
          let lastReason = "";
          for (const to of recipients) {
            const r = await sendDailySummaryEmail(to, summarySubject(name, dateLabel), html);
            if (r.sent) sent++;
            else lastReason = r.reason ?? "unknown";
          }
          await admin
            .from("daily_summary_log")
            .update({ sent })
            .eq("business_id", id)
            .eq("summary_date", summaryDate);
          if (sent < recipients.length) {
            await logEmailUndelivered(admin, {
              businessId: id,
              kind: "Daily summary",
              subjectOf: `${name} (${summaryDate}), ${recipients.length - sent} of ${recipients.length} not delivered`,
              reason: lastReason,
            });
          }
          outcomes.push({
            business_id: id,
            result: sent > 0 ? "sent" : "send_failed",
            recipients: recipients.length,
            sent,
          });
        }

        return json({ summary_date: summaryDate, dry_run, businesses: outcomes.length, outcomes });
      },
    },
  },
});
