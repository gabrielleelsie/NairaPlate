import { describe, expect, it } from "vitest";
import { summaryHtml } from "./daily-summary.server";
import type { CostCheck, DayStats } from "./cost-check";

const day: DayStats = { date_key: "2026-09-30", label: "Wed, 30 Sep", orders: 0, plates: 0, sales_kobo: 0, profit_kobo: 0, dishes: [] };
const pnl = { gross_sales_kobo: 0, recipe_cost_of_goods_kobo: 0, wastage_cost_kobo: 0, cost_of_goods_kobo: 0, gross_margin_kobo: 0, food_cost_percentage: null, paid_orders: 1, daily: [], warnings: [], limitations: [] };
const cc = (over: Partial<CostCheck>): CostCheck => ({ yesterday: day, last_month: day, most_ordered: null, most_profitable: null, attention: [], attention_total: 0, stale: [], stale_total: 0, scarce: [], estimated_lines: 0, uncosted_lines: 0, ...over });
const base = { businessName: "Mama Put", dateLabel: "1 Oct", sentAtLabel: "20:00", pnl, dashboardUrl: "https://x/dashboard", unsubscribeUrl: "https://x/u" };

describe("daily summary cost check block", () => {
  it("is left out when nothing needs attention", () => {
    expect(summaryHtml({ ...base, costCheck: cc({}) })).not.toContain("COST CHECK");
    expect(summaryHtml({ ...base })).not.toContain("COST CHECK");
  });
  it("lists dishes and old prices, and escapes dish names", () => {
    const html = summaryHtml({
      ...base, costCheckUrl: "https://x/cost-check",
      costCheck: cc({ attention_total: 6, stale_total: 2, attention: [{ recipe_id: "1", name: "<b>Jollof</b>", grade: null, price_kobo: 1, cost_per_plate_kobo: 1, margin_pct: 27.4, target_pct: 35, suggested_price_kobo: null, cost_to_cut_kobo: 12000, round_price_kobo: null, round_price_margin_pct: null, week_plates: 5, week_loss_kobo: 1440000, options: [], fallbacks: [] }] }),
    });
    expect(html).toContain("TODAY'S COST CHECK");
    expect(html).toContain("&lt;b&gt;Jollof&lt;/b&gt;: 27% margin, target 35%. Cost needs to come down about ₦120.00 a plate to hold your price");
    expect(html).toContain("about ₦14,400.00 a week below target");
    expect(html).toContain("3 more dishes under target");
    expect(html).toContain("2 ingredient prices are out of date");
    expect(html).not.toContain("<b>Jollof");
  });
});
