// summary-unsubscribe — the "Stop these daily emails" link in the daily summary.
// GET shows a confirmation page with a button; only the POST switches summaries off.
// Two steps on purpose: email security scanners open links automatically, and a plain
// GET that unsubscribed would switch owners off without them ever clicking.
// The link is signed with DAILY_SUMMARY_SECRET (see daily-summary.server.ts), so nobody
// can switch off another business's summaries by editing the URL.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sameHex, unsubscribeSignature } from "@/lib/daily-summary.server";

const SUPABASE_URL = "https://ckklehqascyglqnqtwpn.supabase.co";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | NairaPlate</title></head>
<body style="margin:0;font-family:Figtree,system-ui,-apple-system,'Segoe UI',sans-serif;background:#EAF4FF;color:#0B1F33">
<div style="max-width:520px;margin:48px auto;padding:0 16px">
<div style="background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#0B1F33;color:#fff;padding:18px 24px;font-size:18px;font-weight:800">NairaPlate</div>
<div style="padding:28px 24px"><h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1>${body}</div>
</div></div></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function verify(b: string, s: string): Promise<boolean> {
  const secret = process.env["DAILY_SUMMARY_SECRET"];
  if (!secret || !b || !/^[0-9a-f]{64}$/.test(s)) return false;
  return sameHex(s, await unsubscribeSignature(secret, b));
}

const p = (t: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#4A5563">${t}</p>`;

export const Route = createFileRoute("/api/public/summary-unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const b = url.searchParams.get("b") ?? "";
        const s = url.searchParams.get("s") ?? "";
        if (!(await verify(b, s))) {
          return page(
            "This link is not valid",
            p(
              "Please use the link in your most recent NairaPlate summary email, or message us on WhatsApp.",
            ),
            400,
          );
        }
        return page(
          "Stop daily summary emails?",
          `${p("Owners of this business will stop getting the evening summary of sales, food cost and profit. You can switch it back on from the Staff screen in NairaPlate at any time.")}
<form method="post" action="/api/public/summary-unsubscribe">
<input type="hidden" name="b" value="${esc(b)}"><input type="hidden" name="s" value="${esc(s)}">
<button type="submit" style="min-height:48px;padding:12px 22px;border:0;border-radius:10px;background:#1677D2;color:#fff;font-size:16px;font-weight:700;cursor:pointer">Yes, stop the daily emails</button>
</form>`,
        );
      },
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null);
        const b = String(form?.get("b") ?? "");
        const s = String(form?.get("s") ?? "");
        if (!(await verify(b, s))) {
          return page(
            "This link is not valid",
            p(
              "Please use the link in your most recent NairaPlate summary email, or message us on WhatsApp.",
            ),
            400,
          );
        }
        const serviceKey = process.env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"];
        if (!serviceKey) return page("Something went wrong", p("Please try again later."), 500);
        const admin = createClient(SUPABASE_URL, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await admin
          .from("businesses")
          .update({ daily_summary_enabled: false })
          .eq("id", b);
        if (error)
          return page(
            "Something went wrong",
            p("We could not save that. Please try again, or message us on WhatsApp."),
            500,
          );
        return page(
          "Daily emails stopped",
          p(
            "You will not get the evening summary any more. To switch it back on, open NairaPlate and go to Staff.",
          ),
        );
      },
    },
  },
});
