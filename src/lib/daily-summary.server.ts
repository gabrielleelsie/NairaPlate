// Server-only pieces of the daily summary email: the signed unsubscribe link and the email body.
// The link is signed with DAILY_SUMMARY_SECRET, so nobody can switch off another business's
// summaries by guessing a URL. Uses Web Crypto so it runs on Cloudflare Workers.
import type { PnlResult } from "@/lib/pnl";
import type { CostCheck } from "@/lib/cost-check";

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubscribeSignature(secret: string, businessId: string): Promise<string> {
  return hmacHex(secret, `daily-summary-unsubscribe:${businessId}`);
}

/** Constant-time comparison of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const naira = (kobo: number) =>
  `${kobo < 0 ? "−" : ""}₦${(Math.abs(kobo) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function summarySubject(businessName: string, dateLabel: string): string {
  return `${businessName}: your NairaPlate summary for ${dateLabel}`;
}

/** The email body. Figures come straight from calculateBusinessPnl, the same numbers as the owner dashboard. */
export function summaryHtml(opts: {
  businessName: string;
  dateLabel: string;
  sentAtLabel: string;
  pnl: PnlResult;
  costCheck?: CostCheck | null;
  costCheckUrl?: string;
  dashboardUrl: string;
  unsubscribeUrl: string;
}): string {
  const { pnl } = opts;
  const row = (label: string, value: string, note?: string) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #D3E4F7;font-size:15px;color:#4A5563">${label}${note ? `<div style="font-size:12px;color:#6B7280;margin-top:2px">${note}</div>` : ""}</td>
      <td style="padding:12px 0;border-bottom:1px solid #D3E4F7;font-size:17px;font-weight:700;color:#0B1F33;text-align:right;white-space:nowrap">${value}</td>
    </tr>`;
  const foodPct =
    pnl.food_cost_percentage === null ? "—" : `${pnl.food_cost_percentage.toFixed(1)}%`;
  const cc = opts.costCheck;
  const costCheckBlock = cc && (cc.attention_total > 0 || cc.stale_total > 0)
    ? `<div style="margin:20px 0 0;padding:14px 16px;background:#EAF4FF;border-radius:10px">
        <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#1677D2">TODAY'S COST CHECK</div>
        ${cc.attention.slice(0, 3).map((d) => `<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#0B1F33">${esc(d.name)}: ${d.margin_pct.toFixed(0)}% margin, target ${d.target_pct.toFixed(0)}%${d.cost_to_cut_kobo > 0 ? `. Cost needs to come down about ${naira(d.cost_to_cut_kobo)} a plate to hold your price` : ""}${d.week_loss_kobo !== null ? ` (about ${naira(d.week_loss_kobo)} a week below target)` : ""}.</p>`).join("")}
        ${cc.attention_total > 3 ? `<p style="margin:8px 0 0;font-size:13px;color:#4A5563">${cc.attention_total - 3} more dish${cc.attention_total - 3 === 1 ? "" : "es"} under target.</p>` : ""}
        ${cc.stale_total > 0 ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#0B1F33">${cc.stale_total} ingredient price${cc.stale_total === 1 ? " is" : "s are"} out of date, so some dish costs may be wrong.</p>` : ""}
        ${opts.costCheckUrl ? `<p style="margin:10px 0 0;font-size:13px"><a href="${esc(opts.costCheckUrl)}" style="color:#1677D2">See the full cost check</a></p>` : ""}
      </div>`
    : "";
  const warnings = pnl.warnings.length
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#B42318">${pnl.warnings.map(esc).join("<br>")}</p>`
    : "";
  return `<div style="font-family:Figtree,system-ui,-apple-system,'Segoe UI',sans-serif;background:#EAF4FF;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden">
    <div style="background:#0B1F33;color:#FFFFFF;padding:18px 24px;font-size:18px;font-weight:800">NairaPlate</div>
    <div style="padding:24px">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#1677D2">DAILY SUMMARY</div>
      <h1 style="margin:6px 0 4px;font-size:21px;color:#0B1F33">${esc(opts.businessName)}</h1>
      <p style="margin:0 0 12px;font-size:14px;color:#4A5563">${esc(opts.dateLabel)}, up to ${esc(opts.sentAtLabel)} Nigeria time</p>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        ${row("Money taken from sales", naira(pnl.gross_sales_kobo), `${pnl.paid_orders} paid order${pnl.paid_orders === 1 ? "" : "s"}`)}
        ${row("Cost of food used", naira(pnl.cost_of_goods_kobo), `${naira(pnl.recipe_cost_of_goods_kobo)} in plates sold + ${naira(pnl.wastage_cost_kobo)} wasted`)}
        ${row("Profit after food cost", naira(pnl.gross_margin_kobo))}
        ${row("Food cost as % of sales", foodPct)}
      </table>
      ${warnings}
      ${costCheckBlock}
      <p style="margin:24px 0 0"><a href="${esc(opts.dashboardUrl)}" style="display:inline-block;background:#1677D2;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px">Open your dashboard</a></p>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6B7280">
        These are the same figures as the Profit &amp; loss screen in NairaPlate, worked out from the sales, recipes and purchases recorded today.
        You get this email because you are an owner of ${esc(opts.businessName)} on NairaPlate.
        <a href="${esc(opts.unsubscribeUrl)}" style="color:#1677D2">Stop these daily emails</a>.
      </p>
    </div>
  </div>
</div>`;
}
