import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  C,
  PrimaryButton,
  SiteFooter,
  SiteHeader,
  WhatsAppButton,
  cardStyle,
} from "@/components/site/site-chrome";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact NairaPlate — Talk to us about your kitchen" },
      {
        name: "description",
        content:
          "Questions about pricing, onboarding, or setting up your dishes and market units? Send NairaPlate a message or reach us on WhatsApp.",
      },
      { property: "og:title", content: "Contact NairaPlate — Talk to us about your kitchen" },
      {
        property: "og:description",
        content: "Send NairaPlate a message about pricing, onboarding, or setting up your kitchen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

type Errors = Partial<Record<"name" | "contact" | "message", string>>;

const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: C.text, display: "block", marginBottom: 6 };

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: "100%",
    background: C.white,
    border: `1px solid ${hasError ? C.error : C.border}`,
    borderRadius: 8,
    padding: "12px 16px",
    fontSize: 16,
    fontWeight: 400,
    color: C.text,
    fontFamily: "inherit",
  };
}

function ContactPage() {
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!name.trim()) next.name = "This field is required";
    if (!contact.trim()) next.contact = "This field is required";
    if (!message.trim()) next.message = "This field is required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, business_name: business, contact, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send your message.");
      setSent(true);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <SiteHeader />
      <main className="np-section" style={{ background: C.light }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px" }}>
          <h1 className="np-h2" style={{ color: C.navy, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
            Get in Touch.
          </h1>
          <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, marginTop: 12 }}>
            Questions about pricing, onboarding, or setting up your kitchen? Send a message or reach us directly on
            WhatsApp.
          </p>

          <div style={{ ...cardStyle, marginTop: 24 }}>
            {sent ? (
              <div style={{ display: "grid", gap: 16, justifyItems: "start" }}>
                <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, margin: 0 }}>
                  Thanks — we'll get back to you within a day. If it's urgent, message us on WhatsApp instead.
                </p>
                <WhatsAppButton />
              </div>
            ) : (
              <form onSubmit={submit} noValidate style={{ display: "grid", gap: 18 }}>
                <div>
                  <label htmlFor="c-name" style={labelStyle}>Name</label>
                  <input
                    id="c-name"
                    className="np-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={inputStyle(!!errors.name)}
                  />
                  {errors.name && <p style={{ fontSize: 13, color: C.error, margin: "6px 0 0" }}>{errors.name}</p>}
                </div>

                <div>
                  <label htmlFor="c-business" style={labelStyle}>Business name</label>
                  <input
                    id="c-business"
                    className="np-input"
                    value={business}
                    onChange={(e) => setBusiness(e.target.value)}
                    style={inputStyle(false)}
                  />
                </div>

                <div>
                  <label htmlFor="c-contact" style={labelStyle}>Phone or email</label>
                  <input
                    id="c-contact"
                    className="np-input"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    style={inputStyle(!!errors.contact)}
                  />
                  {errors.contact && <p style={{ fontSize: 13, color: C.error, margin: "6px 0 0" }}>{errors.contact}</p>}
                </div>

                <div>
                  <label htmlFor="c-message" style={labelStyle}>Message</label>
                  <textarea
                    id="c-message"
                    className="np-input"
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    style={{ ...inputStyle(!!errors.message), resize: "vertical" }}
                  />
                  {errors.message && <p style={{ fontSize: 13, color: C.error, margin: "6px 0 0" }}>{errors.message}</p>}
                </div>

                {failed && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{failed}</p>}

                <div>
                  <PrimaryButton type="submit" disabled={busy}>
                    {busy ? "Sending…" : "Send Message"}
                  </PrimaryButton>
                </div>
              </form>
            )}
          </div>

          <div style={{ marginTop: 32 }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 12 }}>Prefer WhatsApp?</p>
            <WhatsAppButton />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
