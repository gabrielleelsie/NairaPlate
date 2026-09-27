// Shared public-site chrome: header, footer, WhatsApp entry points and the design tokens.
// Both "/" and "/contact" import these — the code exists once.
import { Link } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { Logo } from "@/components/Logo";

/** The one WhatsApp link used by the hero, section 6, the floating button and the contact page. */
export const WHATSAPP_HREF =
  "https://wa.me/2349124766666?text=Hello%20NairaPlate%2C%20I%20would%20like%20to%20try%20the%20app%20in%20my%20restaurant";

export const C = {
  navy: "#0B2239",
  blue: "#0078D4",
  blueHover: "#005FA8",
  white: "#FFFFFF",
  light: "#F5F8FB",
  text: "#1A1A1A",
  muted: "#5A6472",
  onNavy: "#E8F0FA",
  mutedOnNavy: "#9FB3C8",
  border: "#E1E8F0",
  success: "#1E8E5A",
  error: "#D92D20",
  whatsapp: "#25D366",
  disabled: "#C4CCD6",
} as const;

export const FONT_STACK =
  '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const cardStyle: React.CSSProperties = {
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 2px 8px rgba(11,34,57,0.06)",
};

export function PrimaryButton({
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className="np-primary-btn"
      style={{
        background: disabled ? C.disabled : C.blue,
        color: C.white,
        borderRadius: 8,
        padding: "14px 28px",
        border: "none",
        fontSize: 16,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function PrimaryLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="np-primary-btn"
      style={{
        display: "inline-block",
        background: C.blue,
        color: C.white,
        borderRadius: 8,
        padding: "14px 28px",
        fontSize: 16,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

export function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="np-secondary-btn"
      style={{
        background: "transparent",
        border: `2px solid ${C.white}`,
        color: C.white,
        borderRadius: 8,
        padding: "12px 26px",
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function WhatsAppButton({
  label = "Message Us on WhatsApp",
  large = false,
}: {
  label?: string;
  large?: boolean;
}) {
  return (
    <a
      href={WHATSAPP_HREF}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        background: C.whatsapp,
        color: C.white,
        borderRadius: 8,
        padding: large ? "18px 36px" : "14px 28px",
        fontSize: 16,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      <MessageCircle size={20} color={C.white} />
      {label}
    </a>
  );
}

/** Rendered on "/" only. */
export function FloatingWhatsApp() {
  return (
    <a
      href={WHATSAPP_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with NairaPlate on WhatsApp"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: C.whatsapp,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        zIndex: 9999,
      }}
    >
      <MessageCircle size={28} color={C.white} />
    </a>
  );
}

export function SiteHeader() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 72,
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        boxShadow: "0 1px 4px rgba(11,34,57,0.04)",
      }}
    >
      <div
        style={{
          maxWidth: 1140,
          margin: "0 auto",
          height: "100%",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <Logo layout="inline" variant="color" size={32} />
        </Link>
        <nav style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Link
            to="/contact"
            className="np-text-link np-hide-sm"
            style={{ color: C.blue, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
          >
            Contact
          </Link>
          <Link
            to="/app"
            className="np-text-link"
            style={{ color: C.blue, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
          >
            Staff Login
          </Link>
          <PrimaryLink to="/signup">Start Free Trial</PrimaryLink>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const linkStyle: React.CSSProperties = {
    color: C.onNavy,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  };
  return (
    <footer style={{ background: C.navy, padding: "48px 24px 32px" }}>
      <div style={{ maxWidth: 1140, margin: "0 auto", display: "grid", gap: 20, justifyItems: "start" }}>
        <Logo layout="stacked" variant="white" size={40} />
        <p style={{ color: C.onNavy, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
          NairaPlate — real-time food costing for Nigerian kitchens.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          <Link to="/contact" className="np-footer-link" style={linkStyle}>Contact</Link>
          <Link to="/app" className="np-footer-link" style={linkStyle}>Staff Login</Link>
          <Link to="/signup" className="np-footer-link" style={linkStyle}>Start Free Trial</Link>
          <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="np-footer-link" style={linkStyle}>
            WhatsApp Support
          </a>
        </div>
        <p style={{ color: C.mutedOnNavy, fontSize: 13, margin: 0 }}>
          © 2026 NairaPlate. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
