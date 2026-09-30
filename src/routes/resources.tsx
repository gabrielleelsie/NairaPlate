import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileText, PlayCircle, MonitorPlay } from "lucide-react";

import {
  C,
  cardStyle,
  FloatingWhatsApp,
  FONT_STACK,
  OutlineLink,
  PrimaryLink,
  SiteFooter,
  SiteHeader,
  WhatsAppButton,
} from "@/components/site/site-chrome";

// The brochure lives in public/resources so it is served as a plain file at this path.
const BROCHURE_PDF = "/resources/NairaPlate-Brochure.pdf";
const BROCHURE_COVER = "/resources/NairaPlate-Brochure-cover.jpg";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Resources | NairaPlate" },
      {
        name: "description",
        content:
          "Download the NairaPlate brochure, take the product tour and watch the demo videos. Food costing for Nigerian kitchens.",
      },
      { property: "og:title", content: "Resources | NairaPlate" },
      {
        property: "og:description",
        content:
          "Download the NairaPlate brochure, take the product tour and watch the demo videos. Food costing for Nigerian kitchens.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResourcesPage,
});

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 48,
  padding: "12px 24px",
  borderRadius: 12,
  fontSize: 17,
  fontWeight: 700,
  textDecoration: "none",
  boxSizing: "border-box",
};

function ResourcesPage() {
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
            <div className="np-section-label" style={{ color: C.onNavy }}>RESOURCES</div>
            <h1 className="np-h1" style={{ color: C.white, margin: "18px 0 0", maxWidth: 760 }}>
              Everything you need to see if NairaPlate fits your kitchen.
            </h1>
            <p className="np-sub" style={{ color: C.onNavy, lineHeight: 1.6, margin: "20px 0 0", maxWidth: 640 }}>
              Download the brochure to share with your team or business partner, click through the product tour, or
              watch the app working.
            </p>
          </div>
        </section>

        <section className="np-section" style={{ background: C.light }}>
          <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px" }}>
            <article
              style={{
                ...cardStyle,
                padding: 0,
                overflow: "hidden",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              <div style={{ background: C.navy, padding: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img
                  src={BROCHURE_COVER}
                  alt="Cover of the NairaPlate brochure, showing a smiling chef and the headline Know what every plate really costs"
                  width={300}
                  height={424}
                  loading="lazy"
                  style={{ width: "100%", maxWidth: 300, height: "auto", borderRadius: 8, boxShadow: "0 16px 32px rgba(0,0,0,0.35)" }}
                />
              </div>
              <div style={{ padding: "40px 32px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.blue, fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
                  <FileText size={20} aria-hidden="true" /> BROCHURE · PDF · 4 PAGES · 570 KB
                </div>
                <h2 style={{ color: C.navy, fontSize: 32, fontWeight: 800, lineHeight: 1.2, margin: 0 }}>
                  The NairaPlate brochure
                </h2>
                <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: 0 }}>
                  How NairaPlate works, a worked Eba &amp; Egusi costing example, the 18 market units it understands,
                  staff roles, and how to start your 7-day free trial. Easy to share on WhatsApp.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                  <a
                    href={BROCHURE_PDF}
                    download="NairaPlate-Brochure.pdf"
                    className="np-primary-btn"
                    style={{ ...linkButtonStyle, background: C.blue, color: C.white }}
                  >
                    <Download size={20} aria-hidden="true" /> Download brochure
                  </a>
                  <a
                    href={BROCHURE_PDF}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="np-outline-btn"
                    style={{ ...linkButtonStyle, border: `2px solid ${C.blue}`, color: C.blue, padding: "10px 22px" }}
                  >
                    View in browser
                  </a>
                </div>
              </div>
            </article>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 24,
                marginTop: 24,
              }}
            >
              <article style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
                <MonitorPlay size={28} color={C.blue} aria-hidden="true" />
                <h2 style={{ color: C.navy, fontSize: 22, fontWeight: 800, margin: 0 }}>Product tour</h2>
                <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, margin: 0, flexGrow: 1 }}>
                  Click through the main screens at your own pace: staff sign-in, market-unit costing, pricing alerts
                  and daily profit.
                </p>
                <div>
                  <OutlineLink to="/presentation">Take the product tour</OutlineLink>
                </div>
              </article>
              <article style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
                <PlayCircle size={28} color={C.blue} aria-hidden="true" />
                <h2 style={{ color: C.navy, fontSize: 22, fontWeight: 800, margin: 0 }}>Demo videos</h2>
                <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, margin: 0, flexGrow: 1 }}>
                  Watch two short demos: the price calculator at work, and a walkthrough of a day in a kitchen
                  using NairaPlate.
                </p>
                <div>
                  <a
                    href="/#demo"
                    className="np-outline-btn"
                    style={{ ...linkButtonStyle, border: `2px solid ${C.blue}`, color: C.blue, padding: "10px 22px" }}
                  >
                    Watch the videos
                  </a>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="np-section" style={{ background: C.white }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
            <h2 style={{ color: C.navy, fontSize: 32, fontWeight: 800, lineHeight: 1.25, margin: 0 }}>
              Questions or pricing? Talk to a real person.
            </h2>
            <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.6, margin: "12px 0 0" }}>
              Message us on WhatsApp for pricing, or start your free trial and we will help you set up your first
              dishes.
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
