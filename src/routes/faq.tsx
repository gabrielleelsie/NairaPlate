import { createFileRoute, Link } from "@tanstack/react-router";
import { monthlyPricesSentence, setupFeesSentence } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";

import {
  C,
  FloatingWhatsApp,
  FONT_STACK,
  PrimaryLink,
  SiteFooter,
  SiteHeader,
  WhatsAppButton,
} from "@/components/site/site-chrome";

const TITLE = "Frequently asked questions | NairaPlate";
const DESCRIPTION =
  "Answers to common questions about NairaPlate: the 7-day free trial, market units, pricing your plates, stock, bank transfers, staff PINs, security and how to get started.";

type Faq = { q: string; a: string };
type Group = { id: string; title: string; items: Faq[] };

// Every answer below is checked against what the app does today. If the app changes, change the answer.
const GROUPS: Group[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        q: "What is NairaPlate?",
        a: "NairaPlate is a food costing and kitchen management app for Nigerian food businesses. It works out what each plate really costs from the prices you actually paid, in the units you actually buy in, and shows the price to charge to keep your margin.",
      },
      {
        q: "Who is it for?",
        a: "Bukas and mama-put kitchens, bakeries and pastry shops, event caterers, cloud kitchens on delivery apps, and quick-service restaurants. If you sell food by the plate, it is for you.",
      },
      {
        q: "Does it work on my phone?",
        a: "Yes. NairaPlate runs in your phone's browser and you can add it to your home screen so it opens like an app, with no app store download. It also works on tablets and computers.",
      },
      {
        q: "Do I need internet to use it?",
        a: "Yes. NairaPlate needs an internet connection. We have not built an offline mode yet.",
      },
    ],
  },
  {
    id: "costing",
    title: "Costing and pricing",
    items: [
      {
        q: "Which market units does it understand?",
        a: "Twenty-two: derica, paint rubber, mudu, tuber, bag, carton, bottle, bunch, market cup, congo, tia, milk cup, cigarette cup, basin, heap, sachet, bowl, jerry can, teaspoon, tablespoon, cooking spoon and measuring cup. For each ingredient you tell NairaPlate how much of its base unit (such as kilograms or litres) one of your market units holds. Recipes can also use kilograms, grams, litres and millilitres.",
      },
      {
        q: "How does it work out the cost of a plate?",
        a: "It converts each ingredient in your recipe into the unit you paid for, multiplies by the price, adds it all up, and divides by the number of plates the recipe makes. You can cost a dish at your latest price or at a chosen grade (A, B or C). For example, 2 derica of garri at 1.2 kg each is 2.4 kg, and at ₦850 a kilogram that is ₦2,040. Add 500 g of egusi at ₦3,000 a kilogram, which is ₦1,500. The total is ₦3,540, and for 10 plates that is ₦354 a plate.",
      },
      {
        q: "How does it decide what price to charge?",
        a: "You choose the margin you want. The suggested price is the cost per plate divided by one minus your margin. At a 35% margin, ₦354 becomes ₦544.62 (₦354 ÷ 0.65). Change your margin or your prices and the answer updates straight away.",
      },
      {
        q: "What happens when an ingredient price goes up?",
        a: "Every purchase you log updates that ingredient's price. NairaPlate compares it with the last price you paid for the same grade, so buying a cheaper grade is not reported as a price rise. When the price rises by more than 5%, the owner gets an alert that names the grade and season. Today's cost check on the home screen then shows which dishes have fallen below their target margin.",
      },
      {
        q: "Do past sales change when prices change?",
        a: "No. Each sale keeps the recipe cost it was made with, so your past profit figures stay true.",
      },
      {
        q: "Can I speak a purchase instead of typing it?",
        a: "Yes, on the purchases screen, in browsers that support voice input. Your browser turns your voice into text and NairaPlate fills in the form for you to check before saving.",
      },
      {
        q: "Does it keep track of my stock?",
        a: "Yes. Each purchase adds stock and wastage takes it off. For a dish you cook to order, each plate sold takes its ingredients off, using the recipe as it was at the sale. A voided order puts them back. Every change is written down with its reason and who made it. You can count what is on the shelf at any time, and the app shows the difference in quantity and in naira. A count by anyone other than the owner waits for the owner to approve it.",
      },
      {
        q: "How do I find waste or leakage?",
        a: "Do a stock take. NairaPlate compares what you counted with what it expected, shows the difference in kilograms and naira, and asks for a reason. The leakage report adds up what is missing, how much of it is recorded wastage, and how much nobody has explained. It shows where the gaps are. It does not say who caused them.",
      },
      {
        q: "Will it tell me before something runs out?",
        a: "Yes. Set a reorder level on each ingredient. When stock falls to that level, or below zero, the owner and the purchaser are alerted. There is one alert for each ingredient until it is marked as seen, and it clears itself when stock is back above the level.",
      },
      {
        q: "What are grade and season on a purchase?",
        a: "Every purchase is marked grade A, B or C, and with a season: Plenty, Normal or Scarce. Prices are kept for each grade, and you can see how prices move through the year. After enough purchases of the same ingredient, the app can suggest a season from your own history. You always choose.",
      },
    ],
  },
  {
    id: "kitchen",
    title: "Running the kitchen",
    items: [
      {
        q: "What else does it track besides food cost?",
        a: "Purchases, recipes, batches cooked, wastage, ingredient stock and stock counts, sales at the till, cash drawer counts, delivery-app payouts, customers who owe you, catering deposits, and what you owe your suppliers. The owner sees profit and loss, a 7-day cashflow view and alerts for low stock and unusual payments.",
      },
      {
        q: "How do my staff sign in?",
        a: "With your business code and their own PIN of 4 to 8 digits. There are no emails or passwords to remember.",
      },
      {
        q: "What can each person see?",
        a: "The owner sees everything, including profit and loss. A supa admin has management access alongside the owner. Purchasers log market purchases, cooks record batches and wastage, and cashiers handle sales and the cash drawer. A cashier never sees the owner's profit figures.",
      },
      {
        q: "Can I see who did what?",
        a: "Yes. NairaPlate keeps an audit log of important actions, and it cannot be edited.",
      },
    ],
  },
  {
    id: "security",
    title: "Your data and security",
    items: [
      {
        q: "Is my business data private?",
        a: "Yes. Each business's records are kept separate from every other business, and each person can only reach the parts their role allows.",
      },
      {
        q: "Are PINs stored safely?",
        a: "PINs are stored only in scrambled form, never as the PIN itself. Staff who enter a wrong PIN too many times are locked out for a while, and the owner can reset a PIN at any time.",
      },
    ],
  },
  {
    id: "trial",
    title: "Trial, plans and payment",
    items: [
      {
        q: "How does the free trial work?",
        a: "You sign up, we review your details and approve your account, and your 7-day free trial starts from that day. We choose the plan that suits your kitchen (Buka, Restaurant or Full Suite) and our team shows you how to use it.",
      },
      {
        q: "Is there a limit during the trial?",
        a: "Yes. Your trial includes the features of your plan, with up to 2 recipes, with up to 12 ingredients in each recipe, and up to 20 ingredients in your list. A paid plan removes these limits.",
      },
      {
        q: "Why do you approve accounts first?",
        a: "So a real person can look at every new business and make sure it gets a good start. Your account stays waiting until we approve it.",
      },
      {
        q: "What happens after the 7 days?",
        a: "To carry on, choose a monthly, 3-month or 12-month period on your plan. When a trial or plan ends, access pauses until we confirm your payment and switch your account back on. Nothing is charged automatically, and your records are kept safe in the meantime.",
      },
      {
        q: "Can the till check that a bank transfer really arrived?",
        a: "Yes, if the owner connects Monnify, which is Moniepoint's payment service for businesses. The cashier chooses Transfer (automatic), and the till shows a one-time account number and the exact amount. When the customer pays, the order turns Paid by itself. Nobody, including the owner, can mark a transfer order paid by hand. You need a Monnify account, and Monnify must approve your business before real payments work.",
      },
      {
        q: "What does automatic transfer cost?",
        a: "NairaPlate adds no charge for it. Monnify takes a fee from each transfer, and the business owner pays it. Monnify's published rate is 1.5% of each transfer (up to ₦2,000) plus 7.5% VAT on that fee, which is about ₦48 on a ₦3,000 plate. Check Monnify's pricing page for today's rate before you switch it on.",
      },
      {
        q: "Does NairaPlate work with my POS terminal or another POS app?",
        a: "NairaPlate has its own till. It does not connect to other POS terminals or apps, so card or transfer payments taken on another device are not read by NairaPlate. Automatic confirmation of bank transfers works through Monnify.",
      },
      {
        q: "Is there a setup fee?",
        a: "Yes. There is no setup fee during the free trial. When you start a paid plan, our team sets up your full menu with you, and you pay the setup fee once. {setup} Message us on WhatsApp.",
      },
      {
        q: "How much does it cost?",
        a: "There are three plans: Buka, Restaurant and Full Suite. {prices} Paying for 3 months or 12 months costs less than month by month. See the pricing page for every price. Message us on WhatsApp to pay, and we will give you the payment details.",
      },
      {
        q: "How do I pay?",
        a: "Message us on WhatsApp and we will give you the payment details. Once we confirm your payment, we switch your plan on.",
      },
    ],
  },
  {
    id: "help",
    title: "Getting help",
    items: [
      {
        q: "How do I get in touch?",
        a: "Message us on WhatsApp on +234 912 476 6666, or use the contact form on this website. A real person replies.",
      },
    ],
  },
];

const PRICES_FALLBACK = "Message us on WhatsApp for current prices.";
const SETUP_FALLBACK = "Message us on WhatsApp for the amount.";
/** The visible answers show the prices an admin has set, so they never go stale. The structured data uses the generic lines. */
const fill = (a: string, prices: string, setup: string) => a.replace("{prices}", prices || PRICES_FALLBACK).replace("{setup}", setup || SETUP_FALLBACK);

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: GROUPS.flatMap((g) => g.items).map((i) => ({
    "@type": "Question",
    name: i.q,
    acceptedAnswer: { "@type": "Answer", text: fill(i.a, "", "") },
  })),
});

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [{ type: "application/ld+json", children: jsonLd }],
  }),
  component: FaqPage,
});

function FaqPage() {
  const { prices } = usePublicSettings();
  const priceLine = monthlyPricesSentence(prices);
  const setupLine = setupFeesSentence(prices);
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
            <div className="np-section-label" style={{ color: C.onNavy }}>FAQ</div>
            <h1 className="np-h1" style={{ color: C.white, margin: "18px 0 0", maxWidth: 760 }}>
              Questions kitchen owners ask us.
            </h1>
            <p className="np-sub" style={{ color: C.onNavy, lineHeight: 1.6, margin: "20px 0 0", maxWidth: 640 }}>
              Straight answers about costing, stock, bank transfers, staff, security, the free trial and paying. Can&apos;t find yours? Message us on WhatsApp.
            </p>
          </div>
        </section>

        <section className="np-section" style={{ background: C.light }}>
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 24px" }}>
            <nav aria-label="FAQ sections" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 40 }}>
              {GROUPS.map((g) => (
                <a
                  key={g.id}
                  href={`#${g.id}`}
                  style={{
                    background: C.white,
                    border: `1px solid ${C.blue}`,
                    color: C.navy,
                    borderRadius: 999,
                    padding: "8px 16px",
                    fontSize: 15,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {g.title}
                </a>
              ))}
            </nav>

            {GROUPS.map((g) => (
              <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} style={{ marginBottom: 40, scrollMarginTop: 88 }}>
                <h2 id={`${g.id}-title`} style={{ color: C.navy, fontSize: 26, fontWeight: 800, margin: "0 0 16px" }}>
                  {g.title}
                </h2>
                <div style={{ display: "grid", gap: 12 }}>
                  {g.items.map((item) => (
                    <details
                      key={item.q}
                      className="np-faq-item"
                      style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14 }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          listStyle: "none",
                          padding: "18px 20px",
                          minHeight: 56,
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 16,
                          color: C.navy,
                          fontSize: 17,
                          fontWeight: 700,
                          lineHeight: 1.4,
                        }}
                      >
                        <span>{item.q}</span>
                        <span aria-hidden="true" className="np-faq-icon" style={{ color: C.blue, fontSize: 26, fontWeight: 400, lineHeight: 1, flexShrink: 0 }}>
                          +
                        </span>
                      </summary>
                      <p style={{ margin: 0, padding: "0 20px 20px", color: C.muted, fontSize: 16, lineHeight: 1.7 }}>{fill(item.a, priceLine, setupLine)}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="np-section" style={{ background: C.white }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
            <h2 style={{ color: C.navy, fontSize: 32, fontWeight: 800, lineHeight: 1.25, margin: 0 }}>
              Still have a question?
            </h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: "12px 0 0" }}>
              Ask us on WhatsApp, or start your free trial and we will help you set up your first dishes.
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
