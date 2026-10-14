// plan-choice: remembers which plan type and term was chosen on the plan page, so a later payment can be checked against it.
// For a signed-in owner (token), or a visitor who gave a store code and the owner's email on it. It changes no access and records no payment.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { amountFor, isMode, isTerm } from "@/lib/plan-choice";
import { mergeSettings } from "@/lib/platform-settings";
import { verifyOwnerEmail } from "@/lib/subscribe-identity.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const Body = z.object({ mode: z.string(), term: z.string(), business_id: z.string().max(100).optional(), email: z.string().max(200).optional() });

export const Route = createFileRoute("/api/public/plan-choice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

        let raw: unknown;
        try { raw = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const parsed = Body.safeParse(raw);
        if (!parsed.success || !isMode(parsed.data.mode) || !isTerm(parsed.data.term)) return json({ error: "Choose a plan and a term." }, 400);
        const { mode, term } = parsed.data;

        // Who is choosing: a signed-in owner (token), or a visitor who gave a store code and the owner's email on it.
        let businessId = "";
        let chosenBy: string | null = null;
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (token) {
          const { data: userData, error: userErr } = await admin.auth.getUser(token);
          if (userErr || !userData.user) return json({ error: "Sign in first." }, 401);
          const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
          businessId = typeof meta["business_id"] === "string" ? meta["business_id"] : "";
          const role = typeof meta["role"] === "string" ? meta["role"] : "";
          if (!businessId || (role !== "owner" && role !== "supa_admin")) return json({ error: "Owners only." }, 403);
          chosenBy = userData.user.id;
        } else {
          const c = await verifyOwnerEmail(admin, parsed.data.business_id ?? "", parsed.data.email ?? "");
          if (!c.ok) return json({ error: "Not available." }, 403);
          businessId = c.businessId;
        }

        const { data: biz } = await admin.from("businesses").select("id, status").eq("id", businessId).maybeSingle();
        if (!biz || (biz.status !== "pending" && biz.status !== "approved" && biz.status !== "suspended")) return json({ error: "Not available." }, 403);

        // The price is worked out here from the price list, never taken from the browser.
        const { data: priceRow } = await admin.from("platform_settings").select("value").eq("key", "prices").maybeSingle();
        const amount = amountFor(mergeSettings({ prices: priceRow?.value }).prices, mode, term);
        const { error } = await admin.from("plan_choices").insert({ business_id: businessId, plan_mode: mode, plan_term: term, amount_kobo: amount, chosen_by: chosenBy });
        if (error) {
          // The table not existing yet is not the owner's problem: they still go on to pay.
          if (error.code === "42P01" || error.code === "PGRST205") return json({ ok: true, saved: false });
          console.error("plan choice failed", error.message);
          return json({ error: "Could not save your choice." }, 500);
        }
        return json({ ok: true, saved: true });
      },
    },
  },
});
