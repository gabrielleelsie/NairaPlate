// staff-pin-login — the only place staff PINs are checked.
// Runs on the server with the service role key of the external NairaPlate Supabase project.
// Actions:
//   { action: "list_staff", business_id }          -> id, display_name, role, is_active (active staff only)
//   { business_id, staff_id, pin } (default login) -> Supabase session
import { createFileRoute } from "@tanstack/react-router";
import { writeAudit } from "@/lib/audit.server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_SmyfkPZXXB_yGEEeRwhZuw_DPo4Jx7z";

const ListSchema = z.object({
  action: z.literal("list_staff"),
  business_id: z.string().trim().min(1).max(100),
});

const LoginSchema = z.object({
  action: z.literal("login").optional(),
  business_id: z.string().trim().min(1).max(100),
  staff_id: z.string().uuid(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4-8 digits"),
});

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

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/staff-pin-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return json({ error: "Server is not configured." }, 500);

        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "Invalid request body." }, 400);
        }

        // ---------- action: list_staff ----------
        if ((raw as { action?: string })?.action === "list_staff") {
          const parsed = ListSchema.safeParse(raw);
          if (!parsed.success) return json({ error: "business_id is required." }, 400);

          const { data, error } = await admin
            .from("staff_users")
            .select("id, display_name, role, is_active")
            .eq("business_id", parsed.data.business_id)
            .eq("is_active", true)
            .order("display_name");
          if (error) return json({ error: "Could not load staff." }, 500);

          // Explicit whitelist: never pin_hash, pin_salt, phone or email.
          const staff = (data ?? []).map((s) => ({
            id: s.id,
            display_name: s.display_name,
            role: s.role,
            is_active: s.is_active,
          }));
          return json({ staff });
        }

        // ---------- action: login ----------
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
        }
        const { business_id, staff_id, pin } = parsed.data;

        const { data: staff, error: fetchErr } = await admin
          .from("staff_users")
          .select("id, business_id, role, display_name, is_active, pin_hash, pin_salt, failed_attempts, locked_until")
          .eq("id", staff_id)
          .eq("business_id", business_id)
          .maybeSingle();
        if (fetchErr) return json({ error: "Could not verify staff." }, 500);
        if (!staff) return json({ error: "Staff member not found." }, 404);

        if (!staff.is_active) return json({ error: "Account deactivated." }, 403);

        const now = Date.now();
        const lockedUntil = Number(staff.locked_until ?? 0);
        if (lockedUntil > now) {
          const remaining_seconds = Math.ceil((lockedUntil - now) / 1000);
          return json({ error: `Too many attempts. Try again in ${remaining_seconds}s.`, remaining_seconds }, 429);
        }

        // No default or fallback PIN, ever.
        if (!staff.pin_hash || !staff.pin_salt) {
          return json({ error: "PIN not set for this account, contact your owner." }, 400);
        }

        const submittedHash = await sha256Hex(staff.pin_salt + pin);
        const ok = timingSafeEqualHex(submittedHash, String(staff.pin_hash).toLowerCase());

        if (!ok) {
          const attempts = (staff.failed_attempts ?? 0) + 1;
          let newLock = 0;
          if (attempts >= 5) newLock = now + 300_000;
          else if (attempts >= 3) newLock = now + 30_000;
          await admin
            .from("staff_users")
            .update({ failed_attempts: attempts, locked_until: newLock })
            .eq("id", staff.id)
            .eq("business_id", business_id);
          const who = { business_id, actor_id: staff.id, actor_role: staff.role, entity_type: "staff_users", entity_id: staff.id };
          await writeAudit(admin, { ...who, action: "login_failed", details: `${staff.display_name}: wrong PIN, attempt ${attempts}` });
          if (newLock > 0) {
            await writeAudit(admin, { ...who, action: "account_locked", details: `${staff.display_name}: locked for ${newLock - now >= 300_000 ? "5 minutes" : "30 seconds"} after ${attempts} wrong PINs` });
          }
          return json({ error: `Wrong PIN. Attempt ${attempts}.`, attempts }, 401);
        }

        // Correct PIN: reset counter.
        await admin
          .from("staff_users")
          .update({ failed_attempts: 0, locked_until: 0 })
          .eq("id", staff.id)
          .eq("business_id", business_id);

        // Real Auth user whose id == staff_id; fresh random password on every login.
        const email = `staff-${staff.id}@nairaplate.local`;
        const password = crypto.randomUUID();
        const app_metadata = { business_id, role: staff.role, staff_id: staff.id };

        const existing = await admin.auth.admin.getUserById(staff.id);
        if (existing.data?.user) {
          const { error } = await admin.auth.admin.updateUserById(staff.id, {
            email,
            password,
            email_confirm: true,
            ban_duration: "none", // lift any block left by a past deactivation
            app_metadata,
            user_metadata: { display_name: staff.display_name },
          });
          if (error) return json({ error: "Could not prepare sign-in." }, 500);
        } else {
          const { error } = await admin.auth.admin.createUser({
            id: staff.id,
            email,
            password,
            email_confirm: true,
            app_metadata,
            user_metadata: { display_name: staff.display_name },
          });
          if (error) return json({ error: "Could not prepare sign-in." }, 500);
        }

        const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
        if (signInErr || !signIn.session) return json({ error: "Sign-in failed." }, 500);
        await writeAudit(admin, { business_id, actor_id: staff.id, actor_role: staff.role, action: "login_success",
          entity_type: "staff_users", entity_id: staff.id, details: `${staff.display_name} signed in` });

        return json({
          session: {
            access_token: signIn.session.access_token,
            refresh_token: signIn.session.refresh_token,
          },
        });
      },
    },
  },
});
