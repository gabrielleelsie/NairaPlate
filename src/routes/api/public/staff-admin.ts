// staff-admin — owner / supa_admin staff management.
// Runs on the server with the service role key of the external NairaPlate Supabase project.
// Every request must carry "Authorization: Bearer <access_token>" from a staff PIN sign-in.
// The caller's business_id and role are read ONLY from the verified token's app_metadata —
// never from the request body — so an owner can only ever touch their own business.
// Actions:
//   { action: "list_staff" }                                   -> id, display_name, role, is_active (incl. inactive)
//   { action: "create_staff", display_name, role, pin }        -> new staff row (hash + salt made here)
//   { action: "deactivate_staff", staff_id }                   -> is_active = false (row is never deleted)
//   { action: "reset_pin", staff_id, pin }                     -> new salt + hash, clears lockout
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";

// Exactly the five values allowed by the staff_users.role CHECK constraint.
const ROLE_VALUES = ["owner", "purchaser", "cook", "cashier", "supa_admin"] as const;
const MANAGER_ROLES = new Set(["owner", "supa_admin"]);

const PinSchema = z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits");

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_staff") }),
  z.object({
    action: z.literal("create_staff"),
    display_name: z.string().trim().min(1, "Name is required").max(80),
    role: z.enum(ROLE_VALUES, { message: "Role must be one of: owner, purchaser, cook, cashier, supa_admin" }),
    pin: PinSchema,
  }),
  z.object({ action: z.literal("deactivate_staff"), staff_id: z.string().uuid() }),
  z.object({ action: z.literal("reset_pin"), staff_id: z.string().uuid(), pin: PinSchema }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Same scheme the PIN login checks: pin_hash = lowercase hex SHA-256(salt + pin).
async function hashPin(pin: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const pin_salt = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const pin_hash = await sha256Hex(pin_salt + pin);
  return { pin_salt, pin_hash };
}

export const Route = createFileRoute("/api/public/staff-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return json({ error: "Server is not configured." }, 500);

        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        // ---------- verify caller ----------
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Not signed in." }, 401);
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData.user) return json({ error: "Session expired. Sign in again." }, 401);

        const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
        const business_id = typeof meta["business_id"] === "string" ? meta["business_id"] : "";
        const tokenRole = typeof meta["role"] === "string" ? meta["role"] : "";
        const callerId = userData.user.id;
        if (!business_id || !MANAGER_ROLES.has(tokenRole)) {
          return json({ error: "Only owners can manage staff." }, 403);
        }

        // Re-check the live row so a deactivated or demoted owner loses access immediately.
        const { data: caller } = await admin
          .from("staff_users")
          .select("role, is_active")
          .eq("id", callerId)
          .eq("business_id", business_id)
          .maybeSingle();
        if (!caller || !caller.is_active || !MANAGER_ROLES.has(caller.role)) {
          return json({ error: "Only owners can manage staff." }, 403);
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "Invalid request body." }, 400);
        }
        const parsed = ActionSchema.safeParse(raw);
        if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
        const body = parsed.data;

        // ---------- list_staff ----------
        if (body.action === "list_staff") {
          const { data, error } = await admin
            .from("staff_users")
            .select("id, display_name, role, is_active")
            .eq("business_id", business_id)
            .order("is_active", { ascending: false })
            .order("display_name");
          if (error) return json({ error: "Could not load staff." }, 500);
          const staff = (data ?? []).map((s) => ({
            id: s.id,
            display_name: s.display_name,
            role: s.role,
            is_active: s.is_active,
          }));
          return json({ staff });
        }

        // ---------- create_staff ----------
        if (body.action === "create_staff") {
          if (body.role === "supa_admin" && caller.role !== "supa_admin") {
            return json({ error: "Only a Supa Admin can add another Supa Admin." }, 403);
          }
          const { pin_salt, pin_hash } = await hashPin(body.pin);
          const { data, error } = await admin
            .from("staff_users")
            .insert({
              business_id,
              display_name: body.display_name,
              role: body.role,
              pin_salt,
              pin_hash,
              is_active: true,
              failed_attempts: 0,
              locked_until: 0,
            })
            .select("id, display_name, role, is_active")
            .single();
          if (error || !data) return json({ error: "Could not add staff member." }, 500);
          return json({ staff: data });
        }

        // Both remaining actions target an existing staff member in the caller's business.
        const { data: target } = await admin
          .from("staff_users")
          .select("id, role, is_active")
          .eq("id", body.staff_id)
          .eq("business_id", business_id)
          .maybeSingle();
        if (!target) return json({ error: "Staff member not found." }, 404);
        if (target.role === "supa_admin" && caller.role !== "supa_admin") {
          return json({ error: "Only a Supa Admin can change a Supa Admin." }, 403);
        }

        // ---------- deactivate_staff ----------
        if (body.action === "deactivate_staff") {
          if (target.id === callerId) return json({ error: "You can't deactivate yourself." }, 400);
          const { error } = await admin
            .from("staff_users")
            .update({ is_active: false })
            .eq("id", target.id)
            .eq("business_id", business_id);
          if (error) return json({ error: "Could not deactivate staff member." }, 500);
          // End any open session: block their login account (PIN login lifts this if reactivated).
          await admin.auth.admin.updateUserById(target.id, { ban_duration: "876000h" }).catch(() => null);
          return json({ ok: true });
        }

        // ---------- reset_pin ----------
        const { pin_salt, pin_hash } = await hashPin(body.pin);
        const { error } = await admin
          .from("staff_users")
          .update({ pin_salt, pin_hash, failed_attempts: 0, locked_until: 0 })
          .eq("id", target.id)
          .eq("business_id", business_id);
        if (error) return json({ error: "Could not reset PIN." }, 500);
        return json({ ok: true });
      },
    },
  },
});
