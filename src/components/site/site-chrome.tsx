// Shared public-site chrome: header, footer, WhatsApp entry points and the design tokens.
// Both "/" and "/contact" import these — the code exists once.
import { Link } from "@tanstack/react-router";
import { Menu, MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

/** The one WhatsApp link used by the hero, section 6, the floating button and the contact page. */
export const WHATSAPP_HREF =
  "https://wa.me/2349124766666?text=Hello%20NairaPlate%2C%20I%20would%20like%20to%20try%20the%20app%20in%20my%20restaurant";

export const C = {
  navy: "#0B1F33",
  blue: "#1677D2",
  blueHover: "#115FA8",
  white: "#FFFFFF",
  light: "#EAF4FF",
  text: "#1A1A1A",
  muted: "#5A6472",
  onNavy: "#EAF4FF",
  mutedOnNavy: "#B9CFE6",
  border: "#D3E4F7",
  success: "#1E8E5A",
  error: "#D92D20",
  whatsapp: "#25D366",
  disabled: "#C4CCD6",
} as const;

export const FONT_STACK =
  'Figtree, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const cardStyle: React.CSSProperties = {
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 2px 8px rgba(11,31,51,0.08)",
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
        borderRadius: 12,
        minHeight: 48,
        padding: "12px 28px",
        border: "none",
        fontSize: 17,
        fontWeight: 700,
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
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        background: C.blue,
        color: C.white,
        borderRadius: 12,
        minHeight: 48,
        padding: "12px 28px",
        fontSize: 17,
        fontWeight: 700,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

/** Secondary outline button for light backgrounds. */
export function OutlineLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="np-outline-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        background: "transparent",
        border: `2px solid ${C.blue}`,
        color: C.blue,
        borderRadius: 12,
        minHeight: 48,
        padding: "10px 26px",
        fontSize: 17,
        fontWeight: 700,
        textDecoration: "none",
        cursor: "pointer",
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
        borderRadius: 12,
        minHeight: 48,
        padding: "10px 26px",
        fontSize: 17,
        fontWeight: 700,
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
        borderRadius: 12,
        minHeight: 48,
        padding: large ? "16px 34px" : "12px 28px",
        fontSize: 17,
        fontWeight: 700,
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
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setScrolledPastHero(window.scrollY >= 700);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  return (
    <a
      href={WHATSAPP_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with NairaPlate on WhatsApp"
      className={`np-floating-whatsapp${scrolledPastHero ? " np-floating-whatsapp-visible" : ""}`}
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    // The menu only exists below 640px; close it if the screen widens (e.g. a tablet is rotated)
    // so the page is never left unable to scroll behind a hidden menu.
    const wideScreen = window.matchMedia("(min-width: 640px)");
    const closeOnWide = () => {
      if (wideScreen.matches) setMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    wideScreen.addEventListener("change", closeOnWide);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      wideScreen.removeEventListener("change", closeOnWide);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      className="np-site-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 72,
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        boxShadow: "0 1px 4px rgba(11,31,51,0.05)",
      }}
    >
      <div
        className="np-site-header-row"
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
          <Logo layout="inline" variant="color" size={32} className="np-hide-sm" />
          <Logo layout="mark" variant="color" size={32} className="np-show-sm" />
        </Link>
        <nav className="np-header-nav">
          <Link
            to="/our-story"
            className="np-text-link np-hide-sm"
            style={{ color: C.navy, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
          >
            Our Story
          </Link>
          <Link
            to="/contact"
            className="np-text-link np-hide-sm"
            style={{ color: C.navy, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
          >
            Contact
          </Link>
          <Link
            to="/app"
            className="np-text-link np-phone-staff-link"
            style={{ color: C.navy, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
          >
            Staff Login
          </Link>
          <span className="np-trial-desktop"><PrimaryLink to="/signup">Start Free Trial</PrimaryLink></span>
          <span className="np-trial-mobile"><PrimaryLink to="/signup">Free Trial</PrimaryLink></span>
          <button
            type="button"
            className="np-phone-menu-button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="np-phone-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </nav>
      </div>
      {menuOpen && (
        <>
          <div className="np-phone-menu-backdrop" aria-hidden="true" onClick={closeMenu} />
          <nav id="np-phone-menu" className="np-phone-menu-panel" aria-label="Main menu">
            <div className="np-phone-menu-links">
              <Link to="/our-story" onClick={closeMenu}>Our Story</Link>
              <Link to="/presentation" onClick={closeMenu}>Product Tour</Link>
              <Link to="/contact" onClick={closeMenu}>Contact</Link>
              <Link to="/app" onClick={closeMenu}>Staff Login</Link>
              <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
                <MessageCircle size={20} color={C.whatsapp} aria-hidden="true" />
                Chat on WhatsApp
              </a>
            </div>
            <Link to="/signup" className="np-phone-menu-trial" onClick={closeMenu}>
              Start 7-Day Free Trial
            </Link>
          </nav>
        </>
      )}
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
        <Logo layout="inline" variant="white" size={40} />
        <p style={{ color: C.onNavy, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
          NairaPlate — real-time food costing for Nigerian kitchens.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          <Link to="/our-story" className="np-footer-link" style={linkStyle}>Our Story</Link>
          <Link to="/presentation" className="np-footer-link" style={linkStyle}>Product Tour</Link>
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
