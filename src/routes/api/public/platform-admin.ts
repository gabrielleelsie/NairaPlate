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
import { sendSecurityAlert, sendOwnerStatusEmail } from "@/lib/email.server";
import { z } from "zod";

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

        // ---------- list_businesses ----------
        if (body.action === "list_businesses") {
          const { data: businesses, error } = await admin
            .from("businesses")
            .select("id, name, status, rejection_reason, created_at, reviewed_at")
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
            .select("id, name, status, rejection_reason, created_at").eq("id", body.business_id).maybeSingle();
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

          const now = Date.now();
          return json({
            business: { ...biz, reason: biz.rejection_reason },
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
            .select("id, name, status").eq("id", body.business_id).maybeSingle();
          if (!before) return json({ error: "Business not found." }, 404);

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
          if (owner?.email) await sendOwnerStatusEmail(owner.email, before.name, body.status, body.reason ?? null);

          return json({ ok: true, status: body.status, was: before.status });
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
          if (owner?.email) await sendOwnerStatusEmail(owner.email, before.name, "suspended", body.reason);

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

        return json({ error: "Unknown action." }, 400);
      },
    },
  },
});
