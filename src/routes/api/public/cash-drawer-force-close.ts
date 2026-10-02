// cash-drawer-force-close — an owner closes a shift that someone left open (with a reason, and optionally a count).
// The caller's business, role and user id come ONLY from the verified login token.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DrawerCloseError, closeDrawerRecord } from "@/lib/cash-drawer.server";
import { businessHasAccess, PLAN_ENDED } from "@/lib/subscription.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";
const OWNER_ROLES = new Set(["owner", "supa_admin"]);
const Body = z.object({
  drawer_id: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
  closing_counted_kobo: z.number().int().min(0).max(1e13).nullable().optional(),
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/cash-drawer-force-close")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!key) return json({ error: "Server is not configured." }, 500);
        const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Not signed in." }, 401);
        const { data: u, error: ue } = await admin.auth.getUser(token);
        if (ue || !u.user) return json({ error: "Session expired. Sign in again." }, 401);
        const meta = (u.user.app_metadata ?? {}) as Record<string, unknown>;
        const business_id = typeof meta["business_id"] === "string" ? meta["business_id"] : "";
        const role = typeof meta["role"] === "string" ? meta["role"] : "";
        if (!business_id || !OWNER_ROLES.has(role)) return json({ error: "Only an owner can close another person's shift." }, 403);
        if (!(await businessHasAccess(admin, business_id))) return json({ error: PLAN_ENDED }, 403);

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Type a reason of at least 5 characters." }, 400);

        const { data: drawer } = await admin.from("cash_drawers").select("*")
          .eq("id", parsed.data.drawer_id).eq("business_id", business_id).eq("status", "open").maybeSingle();
        if (!drawer) return json({ error: "That shift is not open." }, 404);

        const name = String(u.user.user_metadata?.["display_name"] ?? "Owner");
        try {
          return json(await closeDrawerRecord(admin, drawer, {
            countedKobo: parsed.data.closing_counted_kobo ?? null, actor: { id: u.user.id, role, name }, forced: true, reason: parsed.data.reason,
          }));
        } catch (e) {
          if (e instanceof DrawerCloseError) return json({ error: e.message }, e.status);
          return json({ error: "Could not close the shift." }, 500);
        }
      },
    },
  },
});
