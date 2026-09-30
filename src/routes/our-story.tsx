import { createFileRoute, Link } from "@tanstack/react-router";

import chefJpg from "@/assets/nairaplate-chef-logo.jpg";
import chefWebp from "@/assets/nairaplate-chef-logo.webp";
import {
  C,
  FloatingWhatsApp,
  FONT_STACK,
  PrimaryLink,
  SiteFooter,
  SiteHeader,
} from "@/components/site/site-chrome";

export const Route = createFileRoute("/our-story")({
  head: () => ({
    meta: [
      { title: "Our Story | NairaPlate" },
      {
        name: "description",
        content:
          "NairaPlate helps Nigerian food businesses see the true cost of every plate, using the prices they actually paid and the units their kitchen actually uses.",
      },
      { property: "og:title", content: "Our Story | NairaPlate" },
      {
        property: "og:description",
        content:
          "NairaPlate helps Nigerian food businesses see the true cost of every plate, using the prices they actually paid and the units their kitchen actually uses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OurStoryPage,
});

const STORY_PARAGRAPHS = [
  "NairaPlate is a food-tech and kitchen management platform built around a simple but important reality: every plate of food has a true cost, and that cost can change constantly.",
  "For Nigerian food businesses, the cost of running a kitchen is closely tied to what is happening in the market. The price of egusi, oil, garri, rice, meat and other ingredients can change from one purchase to the next. When those changes are not reflected in the cost of a dish, a business can continue selling without realising that its margin is disappearing. NairaPlate is designed to bring clarity to that problem.",
  "Rather than relying on assumptions, outdated figures or complicated spreadsheets, NairaPlate calculates the cost of dishes from what the business actually bought, at the price it actually paid, using the units the kitchen actually works with. This allows businesses to understand the real cost behind what they cook and determine what they should charge to maintain their margin.",
  "The platform is built for the realities of Nigerian food businesses, from bukas and mama-put to bakeries, caterers, cloud kitchens and restaurants. It understands that kitchens do not always operate in standardised international measurements; they may buy and cook using units such as mudu, derica, paint rubber, milk cups, jerry cans, spoons and cups.",
  "Beyond food costing, NairaPlate connects the numbers across the kitchen. Purchasing, recipes, stock, sales, cash control, pricing, profit and reporting can work from one set of figures, giving owners and staff a clearer view of what is happening inside the business.",
];

function ChefPicture() {
  return (
    <picture>
      <source srcSet={chefWebp} type="image/webp" />
      <img
        className="np-story-hero-photo"
        src={chefJpg}
        alt="NairaPlate brand illustration of a smiling Nigerian chef in a blue apron and Ankara headwrap"
        width={440}
        height={540}
      />
    </picture>
  );
}

function OurStoryPage() {
  return (
    <div className="np-public" style={{ fontFamily: FONT_STACK }}>
      <SiteHeader />
      <main>
        <section style={{ background: C.navy, padding: "72px 24px 80px" }}>
          <div className="np-story-hero-grid" style={{ maxWidth: 1140, margin: "0 auto" }}>
            <div>
              <Link
                to="/"
                style={{ color: C.onNavy, display: "inline-block", fontSize: 16, fontWeight: 700, marginBottom: 24, textDecoration: "none" }}
              >
                ← Back to home
              </Link>
              <div className="np-section-label" style={{ color: C.onNavy }}>OUR STORY</div>
              <h1 className="np-h1" style={{ color: C.white, margin: "18px 0 0" }}>Every plate of food has a true cost.</h1>
              <p className="np-sub" style={{ color: C.onNavy, lineHeight: 1.6, margin: "20px 0 0" }}>And that cost can change constantly.</p>
            </div>
            <ChefPicture />
          </div>
        </section>

        <section className="np-section" style={{ background: C.white }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
            {STORY_PARAGRAPHS.map((paragraph) => (
              <p className="np-body-lg" key={paragraph} style={{ color: C.text, fontSize: 18, lineHeight: 1.7, margin: "0 0 26px" }}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="np-section" style={{ background: C.light }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
            <p className="np-story-closing" style={{ color: C.navy, fontSize: 32, fontWeight: 800, lineHeight: 1.25, margin: 0 }}>
              At its core, NairaPlate is about turning everyday kitchen activity into useful financial clarity.
            </p>
            <div className="np-trial-actions" style={{ marginTop: 32 }}>
              <PrimaryLink to="/signup">Start 14-Day Free Trial</PrimaryLink>
              <a className="np-outline-btn" href="/#calculator" style={{ display: "inline-flex", alignItems: "center", minHeight: 48, padding: "10px 26px", border: `2px solid ${C.blue}`, borderRadius: 12, color: C.blue, fontSize: 17, fontWeight: 700, textDecoration: "none" }}>
                Try the Calculator
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <FloatingWhatsApp />
    </div>
  );
}