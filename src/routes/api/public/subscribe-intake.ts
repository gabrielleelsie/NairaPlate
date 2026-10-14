// subscribe-intake: the questions asked before a visitor is sent to pay. Public, but it only ever answers yes or no.
//   { action: "check_new", email?, name? }              -> { email_taken, name_taken }
//   { action: "verify_existing", business_id, email }   -> { ok, setup_paid, email }   (a store code and its owner's email together)
//   { action: "me" } with a signed-in owner's token      -> { ok, business_id, email, setup_paid }
// It changes nothing. A failed check never says which part was wrong.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { escapeLike, normalizeEmail } from "@/lib/selar-intake";
import { setupFeePaid, verifyOwnerEmail } from "@/lib/subscribe-identity.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_new"), email: z.string().max(200).optional(), name: z.string().max(100).optional() }),
  z.object({ action: z.literal("verify_existing"), business_id: z.string().trim().min(1).max(100), email: z.string().max(200) }),
  z.object({ action: z.literal("me") }),
]);

export const Route = createFileRoute("/api/public/subscribe-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
        let raw: unknown;
        try { raw = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const p = Body.safeParse(raw);
        if (!p.success) return json({ error: "Invalid request." }, 400);
        const b = p.data;

        if (b.action === "check_new") {
          const email = normalizeEmail(b.email ?? "");
          let email_taken = false;
          if (email) {
            const { data } = await admin.from("staff_users").select("id").ilike("email", escapeLike(email)).limit(1).maybeSingle();
            email_taken = !!data;
          }
          let name_taken = false;
          const name = (b.name ?? "").trim();
          if (name.length >= 2) {
            const { data } = await admin.from("businesses").select("id").ilike("name", escapeLike(name)).limit(1).maybeSingle();
            name_taken = !!data;
          }
          return json({ email_taken, name_taken });
        }

        if (b.action === "verify_existing") {
          const c = await verifyOwnerEmail(admin, b.business_id, b.email);
          if (!c.ok) return json({ ok: false });
          return json({ ok: true, email: c.email, setup_paid: await setupFeePaid(admin, c.businessId) });
        }

        // me: a signed-in owner
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ ok: false });
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData.user) return json({ ok: false });
        const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
        const businessId = typeof meta["business_id"] === "string" ? meta["business_id"] : "";
        const role = typeof meta["role"] === "string" ? meta["role"] : "";
        if (!businessId || (role !== "owner" && role !== "supa_admin")) return json({ ok: false });
        const { data: owner } = await admin.from("staff_users").select("email").eq("id", userData.user.id).maybeSingle();
        const email = normalizeEmail(owner?.email ?? "");
        return json({ ok: true, business_id: businessId, email, setup_paid: await setupFeePaid(admin, businessId) });
      },
    },
  },
});
