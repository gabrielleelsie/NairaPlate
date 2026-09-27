// contact — public, no sign-in needed. Forwards a website enquiry to the platform admin inbox.
// Rejects oversized payloads and never echoes anything back beyond ok/error.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendContactMessage } from "@/lib/email.server";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(80),
  business_name: z.string().trim().max(100).optional().default(""),
  contact: z.string().trim().min(5, "A phone number or email is required").max(120),
  message: z.string().trim().min(1, "A message is required").max(4000),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return json({ error: "Server is not configured." }, 500);

        let raw: unknown;
        try { raw = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const p = ContactSchema.safeParse(raw);
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid request." }, 400);
        const d = p.data;

        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: admins } = await admin
          .from("staff_users")
          .select("email")
          .eq("role", "platform_admin")
          .eq("is_active", true)
          .not("email", "is", null);

        let sent = false;
        for (const a of admins ?? []) {
          if (!a.email) continue;
          const r = await sendContactMessage(a.email, {
            name: d.name,
            businessName: d.business_name || null,
            contact: d.contact,
            message: d.message,
          });
          sent = sent || r.sent;
        }
        if (!sent) return json({ error: "We couldn't send that just now — please message us on WhatsApp." }, 502);
        return json({ ok: true });
      },
    },
  },
});
