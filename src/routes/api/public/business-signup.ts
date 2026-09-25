// business-signup — public, no sign-in needed.
//   { action: "check_code", business_id }  -> { available, error? }
//   { action: "signup", business_id, name, owner_name, pin, contact } -> business (pending) + owner, saved together
// The PIN is hashed here (same scheme as create_staff); the hash never reaches the browser.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const RESERVED = new Set(["platform", "admin", "nairaplate"]);

export const CodeSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, "Use 3–40 lowercase letters, numbers or dashes (no dash at the start or end).");

const SignupSchema = z.object({
  action: z.literal("signup"),
  business_id: CodeSchema,
  name: z.string().trim().min(2, "Business name is required").max(100),
  owner_name: z.string().trim().min(1, "Your name is required").max(80),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits"),
  contact: z.string().trim().min(5, "Phone or email is required").max(120),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function sha256Hex(input: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/business-signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        let raw: unknown;
        try { raw = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }

        const isTaken = async (code: string) => {
          if (RESERVED.has(code)) return true;
          const { data } = await admin.from("businesses").select("id").eq("id", code).maybeSingle();
          return !!data;
        };

        if ((raw as { action?: string })?.action === "check_code") {
          const c = CodeSchema.safeParse((raw as { business_id?: unknown }).business_id);
          if (!c.success) return json({ available: false, error: c.error.issues[0]?.message });
          return json({ available: !(await isTaken(c.data)) }); // only yes/no — nothing else about the business
        }

        const p = SignupSchema.safeParse(raw);
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid request." }, 400);
        const d = p.data;
        if (await isTaken(d.business_id)) return json({ error: "That business code is taken." }, 409);

        const isEmail = d.contact.includes("@");
        if (isEmail && !z.string().email().safeParse(d.contact).success) return json({ error: "That email doesn't look right." }, 400);
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const pin_salt = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        const pin_hash = await sha256Hex(pin_salt + d.pin);

        const { error } = await admin.rpc("signup_business", {
          p_business_id: d.business_id, p_name: d.name, p_owner_name: d.owner_name,
          p_phone: isEmail ? null : d.contact, p_email: isEmail ? d.contact : null,
          p_pin_hash: pin_hash, p_pin_salt: pin_salt,
        });
        if (error) {
          if (error.code === "23505") return json({ error: "That business code is taken." }, 409);
          return json({ error: "Could not register the business." }, 500);
        }
        // Notification email to the platform admin: not sent yet — no email provider is set up.
        return json({ ok: true, business_id: d.business_id, email_sent: false });
      },
    },
  },
});
