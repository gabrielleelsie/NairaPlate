import { createFileRoute, Link } from "@tanstack/react-router";

import { formatPrice, PLAN_NAME, savingPercent, setupText } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";
import type { OperatingMode } from "@/lib/features";
import {
  C,
  cardStyle,
  FloatingWhatsApp,
  FONT_STACK,
  PrimaryLink,
  SiteFooter,
  SiteHeader,
  WhatsAppButton,
} from "@/components/site/site-chrome";

const TITLE = "Pricing | NairaPlate";
const DESCRIPTION =
  "Three NairaPlate plans for Nigerian kitchens: Buka, Restaurant and Full Suite. Start with 7 days free and pay by bank transfer.";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Plan = {
  mode: OperatingMode;
  bestFor: string;
  includes: string[];
  intro?: string;
};

const PLANS: Plan[] = [
  {
    mode: "buka",
    bestFor: "A small kitchen that sells, buys and counts cash.",
    includes: [
      "Till for taking sales",
      "Cash drawer, opened and closed with counted cash",
      "Orders list",
      "Paper sales, entered later with owner approval",
      "Purchases, suppliers and shopping list",
      "Ingredients, recipes and batches with costs",
      "Staff and PINs",
      "Things to check",
      "Weekly or monthly printable report",
      "Daily summary email each evening on days with sales",
    ],
  },
  {
    mode: "standard",
    bestFor: "A kitchen with staff, suppliers and a menu to cost.",
    intro: "Everything in Buka, plus:",
    includes: [
      "Customer credit",
      "Wastage",
      "Stock take",
      "Receipt capture",
      "Today's cost check",
      "7-day cashflow",
      "“Why did my margin change?” with the top 2 reasons",
      "Audit log",
      "Pricing review",
      "Accountant exports: Sales Day Book, Cash Drawer Summary and Cash Paid Out Register",
    ],
  },
  {
    mode: "advanced",
    bestFor: "A kitchen that wants every tool and every report.",
    intro: "Everything in Restaurant, plus:",
    includes: [
      "Channel payouts",
      "All 8 accountant exports",
      "“Why did my margin change?” with every reason",
    ],
  },
];

const STEPS = [
  "Message us on WhatsApp and tell us whether you want to pay monthly, every 3 months or every 12 months.",
  "We send you our bank details and the exact amount. For your first payment, that is your plan price plus the one-off setup fee.",
  "You pay by bank transfer and send us the proof.",
  "A NairaPlate administrator records your payment and activates your plan.",
];

function PricingPage() {
  const { prices } = usePublicSettings();
  return (
    <div className="np-public" style={{ fontFamily: FONT_STACK }}>
      <SiteHeader />
      <main>
        <section style={{ background: C.navy, padding: "72px 24px 80px" }}>
          <div style={{ maxWidth: 1140, margin: "0 auto" }}>
            <Link
              to="/"
              style={{ color: C.onNavy, display: "inline-block", fontSize: 16, fontWeight: 700, marginBottom: 24, textDecoration: "none" }}
            >
              ← Back to home
            </Link>
            <div className="np-section-label" style={{ color: C.onNavy }}>Pricing</div>
            <h1 className="np-h1" style={{ color: C.white, margin: "18px 0 0", maxWidth: 760 }}>
              Plans for different kinds of food businesses.
            </h1>
            <p className="np-sub" style={{ color: C.onNavy, lineHeight: 1.6, margin: "20px 0 0", maxWidth: 640 }}>
              When we approve your account, we assign the Buka, Restaurant or Full Suite profile that fits your business. Start with 7 days free. Pay by bank transfer.
            </p>
          </div>
        </section>

        <section className="np-section" style={{ background: C.light }}>
          <div
            style={{
              maxWidth: 1140,
              margin: "0 auto",
              padding: "0 24px",
              display: "grid",
              gap: 20,
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            {PLANS.map((p) => {
              const pr = prices.plans[p.mode];
              const ask = "Ask us";
              const q = savingPercent(pr, "quarterly");
              const y = savingPercent(pr, "yearly");
              return (
              <div key={p.mode} style={{ ...cardStyle, padding: 24 }}>
                <h2 style={{ color: C.navy, fontSize: 26, fontWeight: 800, margin: 0 }}>{PLAN_NAME[p.mode]}</h2>
                <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.5, margin: "8px 0 16px" }}>{p.bestFor}</p>
                <dl style={{ margin: 0, display: "grid", gap: 8, color: C.navy, fontSize: 16 }}>
                  <Row label="Monthly" value={formatPrice(pr.monthly_kobo) ?? ask} />
                  <Row label={`Every 3 months${q ? ` (save ${q}%)` : ""}`} value={formatPrice(pr.quarterly_kobo) ?? ask} />
                  <Row label={`Every 12 months${y ? ` (save ${y}%)` : ""}`} value={formatPrice(pr.yearly_kobo) ?? ask} />
                  <Row label="Setup with our team, paid once" value={setupText(pr) ?? ask} />
                </dl>
                {p.intro && <p style={{ color: C.navy, fontWeight: 700, margin: "20px 0 8px" }}>{p.intro}</p>}
                <ul style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, margin: p.intro ? 0 : "20px 0 0", paddingLeft: 20, listStyle: "disc" }}>
                  {p.includes.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
              );
            })}
          </div>
        </section>

        <section className="np-section" style={{ background: C.white }}>
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 24px" }}>
            <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.7, margin: "0 0 32px" }}>
              Every 3 months is the monthly price × 3, less 10%. Every 12 months is the monthly price × 12, less 20%.
            </p>
            <h2 style={{ color: C.navy, fontSize: 28, fontWeight: 800, margin: "0 0 12px" }}>Try NairaPlate free for 7 days</h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.7, margin: 0 }}>
              We assign the Buka, Restaurant or Full Suite profile that fits your business when we approve your account. Your trial includes the features in that profile. During the trial, you can add up to 2 recipes, up to 12 ingredients per recipe and 20 ingredients in total. It starts the day we approve your account and ends at 11:59 pm (Nigeria time) on day 7.
            </p>

            <h2 style={{ color: C.navy, fontSize: 28, fontWeight: 800, margin: "40px 0 12px" }}>Setup</h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.7, margin: 0 }}>
              There is no setup fee during your trial. If you decide to continue, you pay your first plan payment plus a one-off setup fee. Our team then sets up your full menu with you: your market units, ingredients, recipes, dishes and staff.
            </p>

            <h2 style={{ color: C.navy, fontSize: 28, fontWeight: 800, margin: "40px 0 12px" }}>How to pay</h2>
            <ol style={{ color: C.muted, fontSize: 17, lineHeight: 1.8, margin: 0, paddingLeft: 24, listStyle: "decimal" }}>
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>

            <h2 style={{ color: C.navy, fontSize: 28, fontWeight: 800, margin: "40px 0 12px" }}>When your plan ends</h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.7, margin: 0 }}>
              Your plan runs to 11:59 pm on its last day. There is no automatic renewal. When your plan ends, access pauses and your records stay safe. You can pay again to continue.
            </p>
          </div>
        </section>

        <section className="np-section" style={{ background: C.light }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
            <h2 style={{ color: C.navy, fontSize: 32, fontWeight: 800, lineHeight: 1.25, margin: 0 }}>Questions?</h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: "12px 0 0" }}>
              Read the <Link to="/faq" style={{ color: C.navy, fontWeight: 700 }}>FAQ</Link> or message us on WhatsApp.
            </p>
            <div className="np-trial-actions" style={{ marginTop: 32 }}>
              <PrimaryLink to="/signup">Start 7-Day Free Trial</PrimaryLink>
              <WhatsAppButton />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <FloatingWhatsApp />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt style={{ color: C.muted }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 800 }}>{value}</dd>
    </div>
  );
}
