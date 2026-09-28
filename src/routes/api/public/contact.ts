// contact — public, no sign-in needed. Forwards a website enquiry to the platform admin inbox.
// Rejects oversized payloads and never echoes anything back beyond ok/error.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendContactMessage, logEmailUndelivered, NO_ADMIN_EMAIL_REASON } from "@/lib/email.server";
import { z } from "zod";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(100, "Name must be 100 characters or fewer"),
  business_name: z.string().trim().max(150, "Business name must be 150 characters or fewer").optional().default(""),
  contact: z.string().trim().min(1, "A phone number or email is required").max(150, "Phone or email must be 150 characters or fewer"),
  message: z.string().trim().min(1, "A message is required").max(2000, "Message must be 2000 characters or fewer"),
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

        // Save FIRST, so a failed email never loses the lead. Never log the message text.
        const { error: saveErr } = await admin.from("contact_messages").insert({
          name: d.name,
          business_name: d.business_name || null,
          contact: d.contact,
          message: d.message,
        });
        if (saveErr) {
          console.error("contact message save failed");
          return json({ error: "We couldn't send that just now — please message us on WhatsApp." }, 502);
        }

        const { data: admins } = await admin
          .from("staff_users")
          .select("email")
          .eq("role", "platform_admin")
          .eq("is_active", true)
          .not("email", "is", null);

        // Platform-level email: logged against the same "platform" business_id security alerts use.
        // Only the sender's name is recorded — never the message text.
        const recipients = (admins ?? []).map((a) => a.email).filter(Boolean) as string[];
        const subjectOf = `enquiry from ${d.name}`;
        if (recipients.length === 0) {
          await logEmailUndelivered(admin, {
            businessId: "platform", kind: "Contact message", subjectOf, reason: NO_ADMIN_EMAIL_REASON,
          });
        }
        for (const email of recipients) {
          const r = await sendContactMessage(email, {
            name: d.name,
            businessName: d.business_name || null,
            contact: d.contact,
            message: d.message,
          });
          if (!r.sent) {
            await logEmailUndelivered(admin, {
              businessId: "platform", kind: "Contact message", subjectOf,
              reason: r.reason ?? "email request failed or timed out",
            });
          }
        }
        // The message is saved, so the visitor sees success even if the email did not go out.
        return json({ ok: true });
      },
    },
  },
});
