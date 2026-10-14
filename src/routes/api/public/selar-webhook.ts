// selar-webhook: where Selar tells NairaPlate that a subscription payment was made.
// A message with the right secret is saved as one audit line (so we can see what Selar really sends) and, when the table exists,
// staged in selar_payments as "waiting for approval". Only the platform admin is emailed. Buyers and owners get nothing from here.
// NOTHING here records a subscription payment or activates a kitchen: only a platform admin can, through the normal "record payment" path.
// The shared secret lives in the database (platform_settings key "selar_webhook"), never in browser code, and is sent as ?token=... on the web address.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";
import { logEmailUndelivered, NO_ADMIN_EMAIL_REASON, sendSelarAdminAlert } from "@/lib/email.server";
import { mergeSettings } from "@/lib/platform-settings";
import { asMode } from "@/lib/features";
import { SELAR_MAX_BYTES, escapeLike, extractPayment, fallbackRef, isSetupProduct, logLine, normalizeEmail, parseMessage, secretFromSetting, termForAmount, tokenMatches } from "@/lib/selar-intake";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const PLATFORM_BUSINESS = "platform";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/selar-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

        // Check the secret before reading anything else. A missing or wrong secret gets the same plain refusal.
        const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "selar_webhook").maybeSingle();
        const secret = secretFromSetting(setting?.value);
        const sent = new URL(request.url).searchParams.get("token");
        if (!tokenMatches(sent, secret)) return json({ error: "Not accepted." }, 401);

        const raw = await request.text();
        if (raw.length > SELAR_MAX_BYTES) return json({ error: "Too large." }, 413);
        const parsed = parseMessage(raw, request.headers.get("content-type"));

        const { error } = await admin.from("audit_logs").insert({
          business_id: PLATFORM_BUSINESS,
          actor_id: null,
          actor_role: "selar",
          action: "selar_payload_received",
          entity_type: "selar",
          entity_id: null,
          details: logLine(raw, parsed),
        });
        // If the line could not be saved, say so, so the sender shows an error instead of looking successful.
        if (error) { console.error("selar log insert failed", error.message); return json({ error: "Could not save the message." }, 500); }

        // Stage the payment for approval. If the table has not been created yet, the audit line above is all that happens.
        const pay = parsed.fields ? extractPayment(parsed.fields) : null;
        const orderRef = pay?.orderRef ?? (await fallbackRef(raw));
        const setup = isSetupProduct(pay?.productName ?? null);
        const email = normalizeEmail(pay?.buyerEmail ?? null);

        // Match the buyer to a kitchen by the owner email NairaPlate holds. Exactly one approved or suspended kitchen, or it stays unmatched.
        let matched: { id: string; name: string; mode: string | null } | null = null;
        if (email) {
          const { data: owners } = await admin.from("staff_users").select("business_id").eq("role", "owner").eq("is_active", true).ilike("email", escapeLike(email));
          const ids = [...new Set((owners ?? []).map((o) => o.business_id as string))];
          if (ids.length === 1) {
            const { data: biz } = await admin.from("businesses").select("id, name, status, operating_mode").eq("id", ids[0]!).maybeSingle();
            if (biz && (biz.status === "approved" || biz.status === "suspended")) matched = { id: biz.id, name: biz.name, mode: biz.operating_mode ?? null };
          }
        }
        const notNaira = !!pay?.currency && pay.currency !== "NGN";
        const note = !email ? "No usable email address in the message." : !matched ? "The email did not match exactly one kitchen." : notNaira ? `The currency is ${pay?.currency}, not NGN.` : null;

        // The plan term is read from the amount against this kitchen's own price list. A setup payment has no term.
        let term: "monthly" | "quarterly" | "yearly" | null = null;
        if (!setup && matched) {
          const { data: priceRow } = await admin.from("platform_settings").select("value").eq("key", "prices").maybeSingle();
          term = termForAmount(mergeSettings({ prices: priceRow?.value }).prices, asMode(matched.mode), pay?.amountKobo ?? null);
        }
        const { data: staged, error: stageErr } = await admin.from("selar_payments").insert({
          order_ref: orderRef,
          status: matched && !notNaira ? "awaiting_approval" : "unmatched",
          business_code: null,
          matched_business_id: matched?.id ?? null,
          buyer_name: pay?.buyerName ?? null,
          buyer_email: email,
          product_name: pay?.productName ?? null,
          amount_kobo: pay?.amountKobo ?? null,
          plan_guess: term,
          setup_guess: setup,
          paid_at: pay?.paidAt ?? null,
          raw: (parsed.fields ?? { unreadable: raw.slice(0, 8000) }) as never,
          note,
        }).select("id, status").maybeSingle();
        if (stageErr) {
          if (stageErr.code === "23505") return json({ ok: true, duplicate: true }); // the same order again: nothing new
          if (stageErr.code === "42P01" || stageErr.code === "PGRST205") return json({ ok: true, logged: true, staged: false }); // table not created yet
          console.error("selar stage failed", stageErr.message);
          return json({ error: "Could not save the payment." }, 500);
        }
        if (staged) {
          const amountText = pay?.amountKobo != null ? "₦" + (pay.amountKobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }) : "amount not read";
          await writeAudit(admin, {
            business_id: matched?.id ?? PLATFORM_BUSINESS, actor_id: null, actor_role: "selar",
            action: staged.status === "awaiting_approval" ? "selar_payment_staged" : "selar_payment_unmatched",
            entity_type: "selar_payments", entity_id: staged.id,
            details: `Order ${orderRef}, ${amountText}, ${setup ? "setup fee" : "subscription"}, product ${pay?.productName ?? "not read"}${note ? `. ${note}` : ""}`,
          });
          // Tell the platform admins. Never blocks the payment; every skip or failure is written to the audit trail.
          const { data: admins } = await admin.from("staff_users").select("email").eq("role", "platform_admin").eq("is_active", true).not("email", "is", null);
          const recipients = (admins ?? []).map((a) => a.email).filter(Boolean) as string[];
          const subjectOf = `Selar order ${orderRef}`;
          if (recipients.length === 0) await logEmailUndelivered(admin, { businessId: PLATFORM_BUSINESS, kind: "Selar payment alert", subjectOf, reason: NO_ADMIN_EMAIL_REASON });
          const lines = [
            `${setup ? "Setup fee" : "Subscription"} payment: ${amountText}.`,
            `Buyer: ${pay?.buyerName ?? "name not read"} (${email ?? "no email"}).`,
            matched ? `Kitchen: ${matched.name}.` : "Kitchen: not matched. Open the Selar payments tab to choose one.",
            `Selar order: ${orderRef}.`,
          ];
          for (const to of recipients) {
            const r = await sendSelarAdminAlert(to, lines);
            if (!r.sent) await logEmailUndelivered(admin, { businessId: PLATFORM_BUSINESS, kind: "Selar payment alert", subjectOf, reason: r.reason ?? "email request failed or timed out" });
          }
        }
        // 200 so Selar does not keep retrying a message we have already saved.
        return json({ ok: true, logged: true, staged: !!staged });
      },
    },
  },
});
