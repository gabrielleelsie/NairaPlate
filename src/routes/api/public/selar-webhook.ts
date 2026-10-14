// selar-webhook: where Selar tells NairaPlate directly that a subscription payment was made.
// A message with the right secret is saved as one audit line (so we can see what Selar really sends) and, when the table exists,
// staged in selar_payments as "waiting for approval". The buyer gets a "payment received, awaiting approval" email.
// NOTHING here records a subscription payment or activates a kitchen: only a platform admin can, through the normal "record payment" path.
// The shared secret lives in the database (platform_settings key "selar_webhook"), never in browser code, and is sent as ?token=... on the web address.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit.server";
import { logEmailUndelivered, sendSelarReceived } from "@/lib/email.server";
import { SELAR_MAX_BYTES, BUKA_PRODUCT_NAME, bukaTermForAmount, cleanCode, extractPayment, fallbackRef, isBukaProduct, logLine, parseMessage, secretFromSetting, tokenMatches } from "@/lib/selar-intake";

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
        const code = cleanCode(pay?.businessCode ?? null);
        let matched: { id: string; name: string } | null = null;
        if (code) {
          const { data: biz } = await admin.from("businesses").select("id, name, status").eq("id", code).maybeSingle();
          if (biz && (biz.status === "approved" || biz.status === "suspended")) matched = { id: biz.id, name: biz.name };
        }
        // Only the "Buka as a Service" product, at one of its three prices, can wait for approval. Anything else is saved as unmatched.
        const notNaira = !!pay?.currency && pay.currency !== "NGN";
        const term = bukaTermForAmount(pay?.amountKobo ?? null);
        const problem = !isBukaProduct(pay?.productName ?? null) ? `This is not the ${BUKA_PRODUCT_NAME} product.`
          : !term ? "The amount is not one of the three Buka prices."
          : notNaira ? `The currency is ${pay?.currency}, not NGN.`
          : !code ? "No business code in the message."
          : !matched ? "The business code did not match an approved kitchen."
          : null;
        const note = problem;
        const { data: staged, error: stageErr } = await admin.from("selar_payments").insert({
          order_ref: orderRef,
          status: problem ? "unmatched" : "awaiting_approval",
          business_code: code,
          matched_business_id: matched?.id ?? null,
          buyer_name: pay?.buyerName ?? null,
          buyer_email: pay?.buyerEmail ?? null,
          product_name: pay?.productName ?? null,
          amount_kobo: pay?.amountKobo ?? null,
          plan_guess: term,
          setup_guess: false,
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
          const amountText = pay?.amountKobo != null ? "₦" + (pay.amountKobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }) : null;
          await writeAudit(admin, {
            business_id: matched?.id ?? PLATFORM_BUSINESS, actor_id: null, actor_role: "selar",
            action: staged.status === "awaiting_approval" ? "selar_payment_staged" : "selar_payment_unmatched",
            entity_type: "selar_payments", entity_id: staged.id,
            details: `Order ${orderRef}, ${amountText ?? "amount not read"}, product ${pay?.productName ?? "not read"}, code ${code ?? "none"}${note ? `. ${note}` : ""}`,
          });
          if (staged.status === "awaiting_approval" && pay?.buyerEmail) {
            const r = await sendSelarReceived(pay.buyerEmail, pay.buyerName, amountText, orderRef);
            if (!r.sent) await logEmailUndelivered(admin, { businessId: matched?.id ?? PLATFORM_BUSINESS, kind: "Selar payment received", subjectOf: `order ${orderRef}`, reason: r.reason ?? "email request failed or timed out" });
          }
        }
        // 200 so Selar does not keep retrying a message we have already saved.
        return json({ ok: true, logged: true, staged: !!staged });
      },
    },
  },
});
