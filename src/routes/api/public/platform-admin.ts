// platform-admin — NairaPlate support console back end.
// Runs on the server with the service role key of the external NairaPlate Supabase project.
// Every request must carry "Authorization: Bearer <access_token>" from a platform admin sign-in.
// The caller's role is read ONLY from the verified token, never from the request body.
//
// Two tiers of action:
//   Tier 1 — a valid platform admin session is enough:
//     list_businesses, business_detail, set_status (approved | rejected | reactivate), unlock_staff
//   Tier 2 — the admin must also re-enter their OWN current PIN (step-up auth), because a
//     stolen session token alone must never be able to take over or shut down a business:
//     suspend_business, emergency_reset_owner_pin (also limited to once per business per 24h)
//
// Multi-admin by design: actor_id / actor_name on every audit row is the individual
// administrator who acted, never a shared "platform" identity.
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";
import { sendSecurityAlert, sendOwnerStatusEmail, logEmailUndelivered, sendPaymentConfirmation, sendExpiryReminderEmail } from "@/lib/email.server";
import { termFor, formatLagosDate, PLAN_LABEL } from "@/lib/subscription";
import { lagosDateKey } from "@/lib/lagos-time";
import { z } from "zod";
import { SETTING_KEYS, SETTING_LABEL, SETTING_SCHEMAS, mergeSettings, type SettingKey } from "@/lib/platform-settings";
import { NEWS_SCHEMA } from "@/lib/news";
import { REMINDER_KINDS, REMINDER_LABEL, REMINDER_SCHEMA, dueReminder, mergeReminders, renderReminder, type ReminderKind } from "@/lib/reminders";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const PLATFORM_BUSINESS = "platform";
const RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const PinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits");

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_businesses"), search: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("business_detail"), business_id: z.string().trim().min(1).max(100) }),
  z.object({
    action: z.literal("set_status"),
    business_id: z.string().trim().min(1).max(100),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal("unlock_staff"), business_id: z.string().trim().min(1).max(100), staff_id: z.string().uuid() }),
  z.object({ action: z.literal("platform_health") }),
  z.object({
    action: z.literal("record_payment"),
    business_id: z.string().trim().min(1).max(100),
    plan: z.enum(["monthly", "quarterly", "yearly"]),
    amount_kobo: z.number().int().positive("Enter the amount paid.").max(1e12),
    payment_reference: z.string().trim().min(2, "Enter the payment reference.").max(120),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was paid."),
    preview: z.boolean().optional(),
  }),
  z.object({ action: z.literal("get_settings") }),
  z.object({ action: z.literal("save_setting"), key: z.enum(["prices", "locked_screen", "expiry_banner", "reminders", "news"]), value: z.unknown(), admin_pin: PinSchema }),
  z.object({ action: z.literal("reset_setting"), key: z.enum(["prices", "locked_screen", "expiry_banner", "reminders", "news"]), admin_pin: PinSchema }),
  z.object({ action: z.literal("reminders_due") }),
  z.object({ action: z.literal("news_status") }),
  z.object({ action: z.literal("send_test_reminder"), kind: z.enum(["paid_before", "paid_after", "trial_before", "trial_after"]) }),
  z.object({ action: z.literal("list_messages"), handled: z.boolean() }),
  z.object({ action: z.literal("mark_message_handled"), message_id: z.string().uuid() }),
  z.object({
    action: z.literal("audit_query"),
    business_id: z.string().trim().max(100).optional(),
    category: z.enum(["all", "logins", "security", "money", "recipes", "platform_ops"]).optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  }),
  z.object({
    action: z.literal("suspend_business"),
    business_id: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(5, "A written reason is required to suspend a business.").max(300),
    admin_pin: PinSchema,
  }),
  z.object({
    action: z.literal("emergency_reset_owner_pin"),
    business_id: z.string().trim().min(1).max(100),
    staff_id: z.string().uuid(),
    admin_pin: PinSchema,
  }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPin(pin: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const pin_salt = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const pin_hash = await sha256Hex(pin_salt + pin);
  return { pin_salt, pin_hash };
}

/** Step-up auth: the admin's own current PIN, checked server-side against their own row. */
async function verifyAdminPin(admin: SupabaseClient, adminId: string, pin: string): Promise<boolean> {
  const { data } = await admin.from("staff_users")
    .select("pin_hash, pin_salt, is_active, role")
    .eq("id", adminId).eq("role", "platform_admin").maybeSingle();
  if (!data || !data.is_active || !data.pin_salt || !data.pin_hash) return false;
  return timingSafeEqualHex(await sha256Hex(data.pin_salt + pin), String(data.pin_hash).toLowerCase());
}

export const Route = createFileRoute("/api/public/platform-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        // ---------- verify caller is a platform admin ----------
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Not signed in." }, 401);
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData.user) return json({ error: "Session expired. Sign in again." }, 401);
        const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
        if (meta["role"] !== "platform_admin") return json({ error: "Platform admin only." }, 403);
        const adminId = userData.user.id;

        // The individual admin behind this request — recorded on everything they do.
        const { data: adminRow } = await admin.from("staff_users")
          .select("display_name, email, is_active")
          .eq("id", adminId).maybeSingle();
        if (!adminRow?.is_active) return json({ error: "This administrator account is not active." }, 403);
        const adminName = adminRow.display_name ?? "Platform admin";
        const adminEmail = adminRow.email ?? null;
        const origin = request.headers.get("origin") ?? request.headers.get("referer");

        let raw: unknown;
        try { raw = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const parsed = ActionSchema.safeParse(raw);
        if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
        const body = parsed.data;

        // ---------- platform settings: prices and customer-facing wording ----------
        if (body.action === "get_settings") {
          const { data: rows, error } = await admin.from("platform_settings").select("key, value, updated_at, updated_by_name");
          if (error) return json({ error: "Could not load settings: " + error.message }, 500);
          const stored: Record<string, unknown> = {};
          const meta: Record<string, { updated_at: string; updated_by_name: string | null }> = {};
          for (const r of rows ?? []) {
            stored[r.key] = r.value;
            meta[r.key] = { updated_at: r.updated_at, updated_by_name: r.updated_by_name ?? null };
          }
          return json({ settings: mergeSettings(stored), reminders: mergeReminders(stored["reminders"]), news: { enabled: (stored["news"] as { enabled?: boolean } | undefined)?.enabled !== false }, custom: Object.keys(meta), meta });
        }

        if (body.action === "save_setting" || body.action === "reset_setting") {
          const key = body.key as SettingKey | "reminders" | "news";
          if (key !== "reminders" && key !== "news" && !SETTING_KEYS.includes(key)) return json({ error: "Unknown setting." }, 400);
          const label = key === "reminders" ? REMINDER_LABEL : key === "news" ? "News watch" : SETTING_LABEL[key];
          if (!(await verifyAdminPin(admin, adminId, body.admin_pin))) return json({ error: "That PIN is not correct." }, 403);

          const { data: before } = await admin.from("platform_settings").select("value").eq("key", key).maybeSingle();
          const brief = (v: unknown) => (v === undefined || v === null ? "built-in default" : JSON.stringify(v).slice(0, 700));

          if (body.action === "reset_setting") {
            const { error } = await admin.from("platform_settings").delete().eq("key", key);
            if (error) return json({ error: "Could not reset: " + error.message }, 500);
            await writeAudit(admin, {
              business_id: PLATFORM_BUSINESS, actor_id: adminId, actor_role: "platform_admin", action: "platform_setting_changed",
              entity_type: "platform_settings", entity_id: null,
              details: `${adminName}: reset ${label} to the built-in default (was ${brief(before?.value)})`,
            });
            return json({ ok: true });
          }

          const parsedValue = (key === "reminders" ? REMINDER_SCHEMA : key === "news" ? NEWS_SCHEMA : SETTING_SCHEMAS[key]).safeParse(body.value);
          if (!parsedValue.success) return json({ error: parsedValue.error.issues[0]?.message ?? "That setting is not valid." }, 400);
          const { error } = await admin.from("platform_settings").upsert({
            key, value: parsedValue.data, updated_at: new Date().toISOString(), updated_by: adminId, updated_by_name: adminName,
          });
          if (error) return json({ error: "Could not save: " + error.message }, 500);
          await writeAudit(admin, {
            business_id: PLATFORM_BUSINESS, actor_id: adminId, actor_role: "platform_admin", action: "platform_setting_changed",
            entity_type: "platform_settings", entity_id: null,
            details: `${adminName}: changed ${label}. Was: ${brief(before?.value)}. Now: ${brief(parsedValue.data)}`,
          });
          return json({ ok: true });
        }

        // ---------- reminders: who is due today, and a test email to the admin's own address ----------
        if (body.action === "reminders_due") {
          const { data: row } = await admin.from("platform_settings").select("value").eq("key", "reminders").maybeSingle();
          const rs = mergeReminders(row?.value);
          const now = new Date();
          const { data: bs } = await admin.from("businesses").select("id, name, status, plan, access_ends_at").eq("status", "approved").neq("id", PLATFORM_BUSINESS);
          const { data: owners } = await admin.from("staff_users").select("business_id, email, display_name")
            .in("role", ["owner", "supa_admin"]).eq("is_active", true).not("email", "is", null);
          const withEmail = new Map<string, number>();
          for (const o of owners ?? []) if (String(o.email ?? "").includes("@")) withEmail.set(o.business_id as string, (withEmail.get(o.business_id as string) ?? 0) + 1);
          const due = (bs ?? []).flatMap((b) => {
            const d = dueReminder(b as { status: string; plan: string | null; access_ends_at: string | null }, now, rs);
            return d ? [{ business_id: b.id, name: b.name, plan: b.plan, kind: d.kind, offset: d.offset, ends_at: d.ends_at, owner_emails: withEmail.get(b.id as string) ?? 0 }] : [];
          });
          const { data: log } = await admin.from("subscription_reminder_log")
            .select("business_id, kind, offset_days, recipients, sent, created_at").order("created_at", { ascending: false }).limit(15);
          const nameOf = new Map((bs ?? []).map((b) => [b.id as string, b.name as string]));
          return json({ enabled: rs.enabled, due_today: due, recent: (log ?? []).map((l) => ({ ...l, business_name: nameOf.get(l.business_id as string) ?? l.business_id })) });
        }

        if (body.action === "news_status") {
          const { data: st } = await admin.from("news_feed_status").select("source, feed_url, checked_at, last_ok_at, last_error, last_item_count, last_match_count").order("source");
          const { count } = await admin.from("news_items").select("id", { count: "exact", head: true });
          const { data: latest } = await admin.from("news_items").select("title, source, published_at").order("published_at", { ascending: false }).limit(5);
          return json({ outlets: st ?? [], stored: count ?? 0, latest: latest ?? [] });
        }

        if (body.action === "send_test_reminder") {
          if (!adminEmail || !adminEmail.includes("@")) return json({ error: "Your own account has no email address, so there is nowhere to send the test. Add one under My account first." }, 400);
          const { data: row } = await admin.from("platform_settings").select("value").eq("key", "reminders").maybeSingle();
          const rs = mergeReminders(row?.value);
          const kind = body.kind as ReminderKind;
          if (!REMINDER_KINDS.includes(kind)) return json({ error: "Unknown reminder." }, 400);
          const sample = { offset: kind.endsWith("_before") ? 3 : 1, ends_at: "2026-09-30T22:59:59.000Z" };
          const mail = renderReminder(rs, kind, { name: "Mama Put Kitchen", plan: kind.startsWith("trial") ? "trial" : "monthly" }, sample, { test: true });
          const r = await sendExpiryReminderEmail(adminEmail, mail.subject, mail.html);
          if (!r.sent) return json({ error: `The test email was not sent: ${r.reason ?? "unknown reason"}` }, 502);
          return json({ ok: true, sent_to: adminEmail });
        }

        // ---------- list_businesses ----------
        if (body.action === "list_businesses") {
          const { data: businesses, error } = await admin
            .from("businesses")
            .select("id, name, status, rejection_reason, created_at, reviewed_at, plan, trial_started_at, access_ends_at")
            .neq("id", PLATFORM_BUSINESS)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "Could not load businesses." }, 500);

          const { data: staff } = await admin.from("staff_users")
            .select("business_id, display_name, phone, email, role, is_active, locked_until")
            .neq("business_id", PLATFORM_BUSINESS);

          const now = Date.now();
          const rows = (businesses ?? []).map((b) => {
            const mine = (staff ?? []).filter((s) => s.business_id === b.id);
            const owner = mine.find((s) => s.role === "owner");
            return {
              business_id: b.id,
              business_name: b.name,
              status: b.status,
              reason: b.rejection_reason,
              created_at: b.created_at,
              reviewed_at: b.reviewed_at,
              plan: b.plan, trial_started_at: b.trial_started_at, access_ends_at: b.access_ends_at,
              has_access: b.status === "approved" && !!b.access_ends_at && new Date(b.access_ends_at).getTime() > now,
              owner_name: owner?.display_name ?? null,
              owner_contact: owner?.phone ?? owner?.email ?? null,
              active_staff: mine.filter((s) => s.is_active).length,
              locked_staff: mine.filter((s) => Number(s.locked_until ?? 0) > now).length,
            };
          });

          const q = (body.search ?? "").toLowerCase();
          const filtered = q
            ? rows.filter((r) =>
                r.business_id.toLowerCase().includes(q) ||
                r.business_name.toLowerCase().includes(q) ||
                (r.owner_name ?? "").toLowerCase().includes(q) ||
                (r.owner_contact ?? "").toLowerCase().includes(q))
            : rows;
          return json({ businesses: filtered });
        }

        // ---------- business_detail: staff roster + audit trail, never any PIN material ----------
        if (body.action === "business_detail") {
          const { data: biz } = await admin.from("businesses")
            .select("id, name, status, rejection_reason, created_at, plan, trial_started_at, access_ends_at").eq("id", body.business_id).maybeSingle();
          if (!biz) return json({ error: "Business not found." }, 404);

          const { data: staff } = await admin.from("staff_users")
            .select("id, display_name, role, is_active, failed_attempts, locked_until, phone, email, created_at")
            .eq("business_id", body.business_id).order("display_name");

          const { data: logs } = await admin.from("audit_logs")
            .select("id, action, actor_role, details, created_at")
            .eq("business_id", body.business_id).order("created_at", { ascending: false }).limit(60);

          const { data: flags } = await admin.from("margin_flags")
            .select("id, flag_type, severity, message, acknowledged, created_at")
            .eq("business_id", body.business_id).eq("acknowledged", false)
            .order("created_at", { ascending: false }).limit(25);

          const { data: pays } = await admin.from("subscription_payments")
            .select("id, plan, amount_kobo, payment_reference, paid_on, period_start, period_end, recorded_by, created_at")
            .eq("business_id", body.business_id).order("created_at", { ascending: false });
          const recorderIds = [...new Set((pays ?? []).map((p) => p.recorded_by))];
          const { data: recorders } = recorderIds.length
            ? await admin.from("staff_users").select("id, display_name").in("id", recorderIds)
            : { data: [] as { id: string; display_name: string }[] };
          const recName = new Map((recorders ?? []).map((r) => [r.id, r.display_name]));

          const now = Date.now();
          return json({
            business: { ...biz, reason: biz.rejection_reason,
              has_access: biz.status === "approved" && !!biz.access_ends_at && new Date(biz.access_ends_at).getTime() > now },
            payments: (pays ?? []).map((p) => ({ ...p, recorded_by_name: recName.get(p.recorded_by) ?? "Platform admin" })),
            staff: (staff ?? []).map((s) => ({
              id: s.id, display_name: s.display_name, role: s.role, is_active: s.is_active,
              failed_attempts: s.failed_attempts ?? 0,
              locked: Number(s.locked_until ?? 0) > now,
              locked_seconds: Math.max(0, Math.ceil((Number(s.locked_until ?? 0) - now) / 1000)),
              contact: s.phone ?? s.email ?? null,
            })),
            audit: logs ?? [],
            flags: flags ?? [],
          });
        }

        // ---------- set_status: approve, reject, or reactivate a suspended kitchen ----------
        if (body.action === "set_status") {
          const { data: before } = await admin.from("businesses")
            .select("id, name, status, access_ends_at").eq("id", body.business_id).maybeSingle();
          if (!before) return json({ error: "Business not found." }, 404);

          // pending -> approved: the database guard starts the 7-day trial on this same update.
          const { error } = await admin.from("businesses")
            .update({
              status: body.status,
              rejection_reason: body.status === "rejected" ? (body.reason ?? null) : null,
              reviewed_at: new Date().toISOString(),
              reviewed_by: adminId,
            })
            .eq("id", body.business_id);
          if (error) return json({ error: "Could not save: " + error.message }, 500);

          const verb = body.status === "approved"
            ? (before.status === "suspended" ? "business_reactivated" : "business_approved")
            : "business_rejected";
          await writeAudit(admin, {
            business_id: body.business_id, actor_id: adminId, actor_role: "platform_admin",
            action: verb as never, entity_type: "businesses", entity_id: null,
            details: `${adminName}: ${before.name} ${before.status} -> ${body.status}${body.reason ? ` (${body.reason})` : ""}`,
          });

          const { data: owner } = await admin.from("staff_users")
            .select("email").eq("business_id", body.business_id).eq("role", "owner")
            .not("email", "is", null).limit(1).maybeSingle();
          if (owner?.email) {
            const r = await sendOwnerStatusEmail(owner.email, before.name, body.status, body.reason ?? null);
            if (!r.sent) {
              await logEmailUndelivered(admin, {
                businessId: body.business_id, kind: "Owner status notice", actorId: adminId,
                subjectOf: `${before.name} (${body.status})`, reason: r.reason ?? "email request failed or timed out",
              });
            }
          } else {
            await logEmailUndelivered(admin, {
              businessId: body.business_id, kind: "Owner status notice", actorId: adminId,
              subjectOf: `${before.name} (${body.status})`, reason: "the owner has no email address on file",
            });
          }

          const stillExpired = body.status === "approved" && before.status === "suspended" &&
            (!before.access_ends_at || new Date(before.access_ends_at).getTime() <= Date.now());
          return json({
            ok: true, status: body.status, was: before.status,
            ...(stillExpired ? { still_expired: true, message: "Reactivated, but their plan has already ended. Record a payment to give them access." } : {}),
          });
        }

        // ---------- record_payment: a confirmed manual payment extends access (tier 1) ----------
        if (body.action === "record_payment") {
          const today = lagosDateKey(new Date());
          if (body.paid_on > today) return json({ error: "The payment date cannot be in the future." }, 400);
          const { data: biz } = await admin.from("businesses")
            .select("id, name, status, access_ends_at").eq("id", body.business_id).maybeSingle();
          if (!biz) return json({ error: "Business not found." }, 404);
          if (biz.status !== "approved" && biz.status !== "suspended")
            return json({ error: "Only approved or suspended businesses can take a payment." }, 400);

          // A second click or a re-sent form must never add a second term for the same transfer.
          if (!body.preview) {
            const { data: dup } = await admin.from("subscription_payments").select("id")
              .eq("business_id", biz.id).eq("payment_reference", body.payment_reference).limit(1).maybeSingle();
            if (dup) return json({ error: "A payment with that reference is already recorded for this business." }, 409);
          }

          const term = termFor(biz.access_ends_at ? new Date(biz.access_ends_at) : null, new Date(), body.plan);
          const result = { period_start: term.start.toISOString(), period_end: term.end.toISOString() };
          if (body.preview) return json({ ok: true, preview: true, ...result });

          const { error: pe } = await admin.from("subscription_payments").insert({
            business_id: biz.id, plan: body.plan, amount_kobo: body.amount_kobo,
            payment_reference: body.payment_reference, paid_on: body.paid_on,
            period_start: result.period_start, period_end: result.period_end, recorded_by: adminId,
          });
          if (pe) return json({ error: "Could not save the payment: " + pe.message }, 500);
          // Status is never touched here: a suspended business stays suspended.
          const { error: be } = await admin.from("businesses")
            .update({ plan: body.plan, access_ends_at: result.period_end }).eq("id", biz.id);
          if (be) return json({ error: "Payment saved but access was not extended: " + be.message }, 500);

          const amountText = "₦" + (body.amount_kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });
          const endsText = formatLagosDate(term.end);
          await writeAudit(admin, {
            business_id: biz.id, actor_id: adminId, actor_role: "platform_admin",
            action: "subscription_payment_recorded", entity_type: "subscription_payments", entity_id: null,
            details: `${adminName}: ${PLAN_LABEL[body.plan]} ${amountText} (ref ${body.payment_reference}, paid ${body.paid_on}) — access until ${endsText}`,
          });

          const { data: owner } = await admin.from("staff_users")
            .select("email").eq("business_id", biz.id).eq("role", "owner")
            .not("email", "is", null).limit(1).maybeSingle();
          const subjectOf = `${biz.name} (payment ${body.payment_reference})`;
          if (owner?.email) {
            const r = await sendPaymentConfirmation(owner.email, biz.name, PLAN_LABEL[body.plan] ?? body.plan, amountText, body.payment_reference, endsText);
            if (!r.sent) await logEmailUndelivered(admin, { businessId: biz.id, kind: "Payment confirmation", actorId: adminId, subjectOf, reason: r.reason ?? "email request failed or timed out" });
          } else {
            await logEmailUndelivered(admin, { businessId: biz.id, kind: "Payment confirmation", actorId: adminId, subjectOf, reason: "the owner has no email address on file" });
          }
          return json({ ok: true, ...result, still_suspended: biz.status === "suspended" });
        }

        // ---------- list_messages: website contact messages (tier 1, read-only) ----------
        if (body.action === "list_messages") {
          const [{ data, error }, { count }] = await Promise.all([
            admin.from("contact_messages")
              .select("id, name, business_name, contact, message, created_at, handled, handled_at")
              .eq("handled", body.handled).order("created_at", { ascending: false }).limit(200),
            admin.from("contact_messages").select("id", { count: "exact", head: true }).eq("handled", false),
          ]);
          if (error) return json({ error: "Could not load messages." }, 500);
          return json({ messages: data ?? [], unhandled: count ?? 0 });
        }

        // ---------- mark_message_handled (tier 1). Audit records the sender's name only. ----------
        if (body.action === "mark_message_handled") {
          const { data: m } = await admin.from("contact_messages")
            .select("id, name, handled").eq("id", body.message_id).maybeSingle();
          if (!m) return json({ error: "Message not found." }, 404);
          if (m.handled) return json({ ok: true });
          const { error } = await admin.from("contact_messages")
            .update({ handled: true, handled_by: adminId, handled_at: new Date().toISOString() })
            .eq("id", m.id);
          if (error) return json({ error: "Could not update the message." }, 500);
          await writeAudit(admin, {
            business_id: PLATFORM_BUSINESS, actor_id: adminId, actor_role: "platform_admin",
            action: "contact_message_handled", entity_type: "contact_messages", entity_id: m.id,
            details: `${adminName} marked the message from ${m.name} as handled`,
          });
          return json({ ok: true });
        }

        // ---------- unlock_staff: clear a PIN lockout (tier 1, low risk) ----------
        if (body.action === "unlock_staff") {
          const { data: target } = await admin.from("staff_users")
            .select("id, display_name, role").eq("id", body.staff_id).eq("business_id", body.business_id).maybeSingle();
          if (!target) return json({ error: "Staff member not found." }, 404);

          const { error } = await admin.from("staff_users")
            .update({ failed_attempts: 0, locked_until: 0 }).eq("id", target.id);
          if (error) return json({ error: "Could not unlock the account." }, 500);

          await writeAudit(admin, {
            business_id: body.business_id, actor_id: adminId, actor_role: "platform_admin",
            action: "platform_unlock_staff", entity_type: "staff_users", entity_id: target.id,
            details: `${adminName} cleared the PIN lockout on ${target.display_name} (${target.role})`,
          });
          return json({ ok: true, display_name: target.display_name });
        }

        // ---------- suspend_business: TIER 2, admin's own PIN required ----------
        if (body.action === "suspend_business") {
          if (!(await verifyAdminPin(admin, adminId, body.admin_pin)))
            return json({ error: "Your PIN is wrong. Suspending a business needs your own PIN." }, 401);

          const { data: before } = await admin.from("businesses")
            .select("id, name, status").eq("id", body.business_id).maybeSingle();
          if (!before) return json({ error: "Business not found." }, 404);
          if (before.status === "suspended") return json({ error: "That business is already suspended." }, 409);

          const { error } = await admin.from("businesses")
            .update({ status: "suspended", rejection_reason: body.reason, reviewed_at: new Date().toISOString(), reviewed_by: adminId })
            .eq("id", body.business_id);
          if (error) return json({ error: "Could not suspend: " + error.message }, 500);

          await writeAudit(admin, {
            business_id: body.business_id, actor_id: adminId, actor_role: "platform_admin",
            action: "business_suspended" as never, entity_type: "businesses", entity_id: null,
            details: `${adminName} suspended ${before.name}: ${body.reason}`,
          });

          if (adminEmail) {
            await sendSecurityAlert(admin, {
              to: adminEmail, adminName, action: "business suspended",
              businessName: before.name, businessId: body.business_id,
              detail: `Reason given: ${body.reason}. Every staff member at this business is now blocked from signing in.`,
              origin,
            });
          }

          const { data: owner } = await admin.from("staff_users")
            .select("email").eq("business_id", body.business_id).eq("role", "owner")
            .not("email", "is", null).limit(1).maybeSingle();
          if (owner?.email) {
            const r = await sendOwnerStatusEmail(owner.email, before.name, "suspended", body.reason);
            if (!r.sent) {
              await logEmailUndelivered(admin, {
                businessId: body.business_id, kind: "Owner status notice", actorId: adminId,
                subjectOf: `${before.name} (suspended)`, reason: r.reason ?? "email request failed or timed out",
              });
            }
          } else {
            await logEmailUndelivered(admin, {
              businessId: body.business_id, kind: "Owner status notice", actorId: adminId,
              subjectOf: `${before.name} (suspended)`, reason: "the owner has no email address on file",
            });
          }

          return json({ ok: true });
        }

        // ---------- emergency_reset_owner_pin: TIER 2 + 24h cooldown ----------
        if (body.action === "emergency_reset_owner_pin") {
          if (!(await verifyAdminPin(admin, adminId, body.admin_pin)))
            return json({ error: "Your PIN is wrong. An emergency reset needs your own PIN." }, 401);

          const { data: target } = await admin.from("staff_users")
            .select("id, display_name, role, business_id")
            .eq("id", body.staff_id).eq("business_id", body.business_id).maybeSingle();
          if (!target) return json({ error: "Staff member not found." }, 404);
          if (target.role !== "owner" && target.role !== "supa_admin")
            return json({ error: "Emergency reset is only for an owner locked out of their own business. Use the normal unlock for other staff." }, 400);

          // One emergency reset per business per 24 hours, whoever asks.
          const since = new Date(Date.now() - RESET_COOLDOWN_MS).toISOString();
          const { data: recent } = await admin.from("audit_logs")
            .select("id, created_at").eq("business_id", body.business_id)
            .eq("action", "emergency_owner_pin_reset").gte("created_at", since).limit(1);
          if (recent && recent.length > 0) {
            await writeAudit(admin, {
              business_id: body.business_id, actor_id: adminId, actor_role: "platform_admin",
              action: "emergency_reset_blocked", entity_type: "staff_users", entity_id: target.id,
              details: `${adminName} tried a second emergency reset on ${target.display_name} inside 24 hours — blocked`,
            });
            return json({ error: "An emergency reset was already issued for this owner in the last 24 hours. If further assistance is needed, verify the owner's identity directly." }, 429);
          }

          const newPin = String(Math.floor(100000 + Math.random() * 900000));
          const { pin_salt, pin_hash } = await hashPin(newPin);
          const { error } = await admin.from("staff_users")
            .update({ pin_salt, pin_hash, failed_attempts: 0, locked_until: 0 }).eq("id", target.id);
          if (error) return json({ error: "Could not reset the PIN." }, 500);

          const { data: biz } = await admin.from("businesses").select("name").eq("id", body.business_id).maybeSingle();
          const businessName = biz?.name ?? body.business_id;

          await writeAudit(admin, {
            business_id: body.business_id, actor_id: adminId, actor_role: "platform_admin",
            action: "emergency_owner_pin_reset", entity_type: "staff_users", entity_id: target.id,
            details: `${adminName} issued an emergency PIN reset for ${target.display_name} (${target.role}) at ${businessName}${origin ? ` from ${origin}` : ""}`,
          });

          let alerted = false;
          if (adminEmail) {
            const r = await sendSecurityAlert(admin, {
              to: adminEmail, adminName, action: "emergency owner PIN reset",
              businessName, businessId: body.business_id,
              detail: `The PIN for ${target.display_name} (${target.role}) was reset. If this was not you, treat the platform admin account as compromised and change its PIN immediately.`,
              origin,
            });
            alerted = r.sent;
          }

          // The PIN is returned once, to be read out to the owner, and never stored in plain text.
          return json({ ok: true, pin: newPin, display_name: target.display_name, alerted });
        }

        // ---------- platform_health: read-only vitals across every tenant (tier 1) ----------
        if (body.action === "platform_health") {
          const startedAt = Date.now();
          const now = Date.now();
          const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
          const startOfToday = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();

          const [bizRes, staffRes, ordersRes, flagsRes, auditRes, opsRes] = await Promise.all([
            admin.from("businesses").select("id, name, status, plan, access_ends_at").neq("id", PLATFORM_BUSINESS),
            admin.from("staff_users").select("business_id, display_name, role, is_active, locked_until").neq("business_id", PLATFORM_BUSINESS),
            admin.from("orders").select("business_id, total_kobo, status, created_at").gte("created_at", weekAgo),
            admin.from("margin_flags").select("business_id, flag_type, severity, message, created_at").eq("acknowledged", false)
              .order("created_at", { ascending: false }).limit(200),
            admin.from("audit_logs").select("business_id, action, created_at").gte("created_at", dayAgo).limit(2000),
            admin.from("audit_logs").select("id, business_id, action, actor_role, details, created_at")
              .in("action", ["business_approved", "business_rejected", "business_suspended", "business_reactivated", "subscription_payment_recorded",
                "platform_unlock_staff", "emergency_owner_pin_reset", "emergency_reset_blocked", "security_alert_undelivered"])
              .order("created_at", { ascending: false }).limit(12),
          ]);

          const latency_ms = Date.now() - startedAt;
          const businesses = bizRes.data ?? [];
          const staff = staffRes.data ?? [];
          const orders = ordersRes.data ?? [];
          const flags = flagsRes.data ?? [];
          const recentAudit = auditRes.data ?? [];
          const nameOf = (id: string) => businesses.find((b) => b.id === id)?.name ?? id;

          const byStatus = { approved: 0, pending: 0, suspended: 0, rejected: 0 } as Record<string, number>;
          for (const b of businesses) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

          const lockedStaff = staff.filter((s) => Number(s.locked_until ?? 0) > now);
          const paidOrders = orders.filter((o) => o.status !== "voided" && o.status !== "cancelled");
          const gmvToday = paidOrders.filter((o) => o.created_at >= startOfToday)
            .reduce((n, o) => n + Number(o.total_kobo ?? 0), 0);
          const gmvWeek = paidOrders.reduce((n, o) => n + Number(o.total_kobo ?? 0), 0);
          const ordersToday = paidOrders.filter((o) => o.created_at >= startOfToday).length;

          // Businesses that need a human look right now.
          const watchMap = new Map<string, { business_id: string; business_name: string; locked: number; flags: number; reasons: string[] }>();
          const bump = (id: string) => {
            if (!watchMap.has(id)) watchMap.set(id, { business_id: id, business_name: nameOf(id), locked: 0, flags: 0, reasons: [] });
            return watchMap.get(id)!;
          };
          for (const s of lockedStaff) { const w = bump(s.business_id); w.locked += 1; }
          for (const f of flags) { const w = bump(f.business_id); w.flags += 1; }
          for (const w of watchMap.values()) {
            if (w.locked) w.reasons.push(`${w.locked} staff locked out`);
            if (w.flags) w.reasons.push(`${w.flags} open flag${w.flags === 1 ? "" : "s"}`);
          }
          const watchlist = [...watchMap.values()].sort((a, b) => (b.locked * 10 + b.flags) - (a.locked * 10 + a.flags)).slice(0, 8);

          return json({
            generated_at: new Date().toISOString(),
            latency_ms,
            tenants: {
              total: businesses.length,
              approved: byStatus["approved"] ?? 0,
              pending: byStatus["pending"] ?? 0,
              suspended: byStatus["suspended"] ?? 0,
              rejected: byStatus["rejected"] ?? 0,
              on_trial: businesses.filter((b) => b.status === "approved" && b.plan === "trial" && b.access_ends_at && new Date(b.access_ends_at).getTime() > now).length,
              active_paid: businesses.filter((b) => b.status === "approved" && b.plan && b.plan !== "trial" && b.access_ends_at && new Date(b.access_ends_at).getTime() > now).length,
              expired: businesses.filter((b) => b.status === "approved" && (!b.access_ends_at || new Date(b.access_ends_at).getTime() <= now)).length,
            },
            people: {
              active_staff: staff.filter((s) => s.is_active).length,
              locked_now: lockedStaff.length,
              failed_logins_24h: recentAudit.filter((a) => a.action === "login_failed").length,
              successful_logins_24h: recentAudit.filter((a) => a.action === "login_success").length,
              lockouts_24h: recentAudit.filter((a) => a.action === "account_locked").length,
            },
            activity: {
              orders_today: ordersToday,
              gmv_today_kobo: gmvToday,
              gmv_week_kobo: gmvWeek,
              events_24h: recentAudit.length,
            },
            flags: {
              open_total: flags.length,
              critical: flags.filter((f) => f.severity === "critical" || f.severity === "high").length,
            },
            watchlist,
            recent_ops: (opsRes.data ?? []).map((r) => ({ ...r, business_name: nameOf(r.business_id) })),
          });
        }

        // ---------- audit_query: the tenant audit inspector (tier 1, read-only) ----------
        if (body.action === "audit_query") {
          const CATEGORY: Record<string, string[]> = {
            logins: ["login_success", "login_failed"],
            security: ["account_locked", "pin_reset", "staff_created", "role_changed", "staff_deactivated", "security_alert_undelivered"],
            money: ["platform_setting_changed", "drawer_discrepancy", "order_adjusted", "order_voided", "order_refunded", "payout_logged", "price_decided", "purchase_logged"],
            recipes: ["cost_changed", "recipe_version_saved", "price_published", "batch_logged", "wastage_logged"],
            platform_ops: ["platform_unlock_staff", "emergency_owner_pin_reset", "emergency_reset_blocked",
              "business_approved", "business_rejected", "business_suspended", "business_reactivated",
              "email_undelivered", "security_alert_undelivered", "contact_message_handled", "subscription_payment_recorded", "platform_setting_changed"],
          };

          const limit = body.limit ?? 50;
          const offset = body.offset ?? 0;
          const category = body.category ?? "all";

          let q = admin.from("audit_logs")
            .select("id, business_id, actor_id, actor_role, action, entity_type, entity_id, details, created_at", { count: "exact" });

          if (body.business_id) q = q.eq("business_id", body.business_id);
          if (category !== "all" && CATEGORY[category]) q = q.in("action", CATEGORY[category]!);
          if (body.search) q = q.or(`details.ilike.%${body.search}%,action.ilike.%${body.search}%`);

          const { data, count, error } = await q
            .order("created_at", { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) return json({ error: "Could not load the audit trail." }, 500);

          const rows = data ?? [];
          const bizIds = [...new Set(rows.map((r) => r.business_id))];
          const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];

          const [{ data: bizs }, { data: actors }] = await Promise.all([
            admin.from("businesses").select("id, name").in("id", bizIds.length ? bizIds : ["__none__"]),
            admin.from("staff_users").select("id, display_name").in("id", actorIds.length ? actorIds : ["00000000-0000-0000-0000-000000000000"]),
          ]);

          const bizName = new Map((bizs ?? []).map((b) => [b.id, b.name]));
          const actorName = new Map((actors ?? []).map((a) => [a.id, a.display_name]));

          return json({
            total: count ?? 0,
            offset,
            limit,
            events: rows.map((r) => ({
              id: r.id,
              business_id: r.business_id,
              business_name: bizName.get(r.business_id) ?? r.business_id,
              action: r.action,
              actor_role: r.actor_role,
              actor_name: r.actor_id ? (actorName.get(r.actor_id) ?? "Removed staff") : "System",
              entity_type: r.entity_type,
              details: r.details,
              created_at: r.created_at,
            })),
          });
        }

        return json({ error: "Unknown action." }, 400);
      },
    },
  },
});
