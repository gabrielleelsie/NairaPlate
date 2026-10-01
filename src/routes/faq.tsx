import { createFileRoute, Link } from "@tanstack/react-router";

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
  "Answers to common questions about NairaPlate: the 7-day free trial, market units, pricing your plates, staff PINs, security and how to get started.";

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
        a: "Eighteen: derica, paint rubber, mudu, tuber, bag, carton, bottle, bunch, market cup, congo, tia, milk cup, cigarette cup, basin, heap, sachet, bowl and jerry can. Recipes can also use kilograms, grams, litres, millilitres, spoons and cups.",
      },
      {
        q: "How does it work out the cost of a plate?",
        a: "It converts each ingredient in your recipe into the unit you paid for, multiplies by your latest price, adds it all up, and divides by the number of plates the recipe makes. For example, 2 derica of garri and 500 g of egusi for 10 plates costs ₦418.91 a plate at the demo kitchen's prices.",
      },
      {
        q: "How does it decide what price to charge?",
        a: "You choose the margin you want. The suggested price is the cost per plate divided by one minus your margin. At a 35% margin, ₦418.91 becomes ₦644.48. Change your margin or your prices and the answer updates straight away.",
      },
      {
        q: "What happens when an ingredient price goes up?",
        a: "Every purchase you log updates that ingredient's price. When an ingredient rises by more than 5%, NairaPlate flags every dish that uses it so you can decide whether to change the price.",
      },
      {
        q: "Do past sales change when prices change?",
        a: "No. Each sale keeps the recipe cost it was made with, so your past profit figures stay true.",
      },
      {
        q: "Can I speak a purchase instead of typing it?",
        a: "Yes, on the purchases screen, in browsers that support voice input. Your browser turns your voice into text and NairaPlate fills in the form for you to check before saving.",
      },
    ],
  },
  {
    id: "kitchen",
    title: "Running the kitchen",
    items: [
      {
        q: "What else does it track besides food cost?",
        a: "Purchases, recipes, batches cooked, wastage, sales at the till, cash drawer counts, delivery-app payouts, customers who owe you, catering deposits, and what you owe your suppliers. The owner sees profit and loss and a 7-day cashflow view.",
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
        a: "You sign up, we review your details and approve your account, and your 7-day free trial starts from that day with every feature switched on. We also help you set up your 2 recipes and your market-unit conversions so you do not start from a blank screen.",
      },
      {
        q: "Is there a limit during the trial?",
        a: "Yes. Every feature is on, but a trial includes up to 2 recipes, with up to 12 ingredients in each recipe, and up to 20 ingredients in your list. A paid plan removes these limits.",
      },
      {
        q: "Why do you approve accounts first?",
        a: "So a real person can look at every new business, set it up properly and make sure it gets a good start. Your account stays waiting until we approve it.",
      },
      {
        q: "What happens after the 7 days?",
        a: "To carry on, choose a Monthly, Quarterly or Yearly plan. When a trial or plan ends, access pauses until we confirm your payment and switch your account back on. Nothing is charged automatically, and your records are kept safe in the meantime.",
      },
      {
        q: "How much does it cost?",
        a: "Message us on WhatsApp for current prices. We will tell you what each plan costs and how to pay.",
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

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: GROUPS.flatMap((g) => g.items).map((i) => ({
    "@type": "Question",
    name: i.q,
    acceptedAnswer: { "@type": "Answer", text: i.a },
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
              Straight answers about costing, staff, security, the free trial and paying. Can&apos;t find yours? Message us on WhatsApp.
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
                      <p style={{ margin: 0, padding: "0 20px 20px", color: C.muted, fontSize: 16, lineHeight: 1.7 }}>{item.a}</p>
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
