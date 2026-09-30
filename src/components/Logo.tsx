import { cn } from "@/lib/utils";

type LogoProps = {
  size?: number;
  variant?: "color" | "white";
  layout?: "stacked" | "inline" | "mark";
  className?: string;
};

export function Logo({ size = 48, variant = "color", layout = "inline", className }: LogoProps) {
  const isWhite = variant === "white";
  const mark = (
    <svg
      aria-hidden="true"
      viewBox="-640 -640 1280 1280"
      width={size}
      height={size}
      className="shrink-0"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeWidth="48" strokeLinejoin="round">
        <path d="M-316.8 -512.9A605 605 0 0 0 -587.8 125.6L-491.8 101.2A506 506 0 0 1 -267.6 -426.9Z" />
        <path d="M-556.9 226.9A605 605 0 0 0 -237.5 554.7L-201.5 462.4A506 506 0 0 1 -463.6 193.4Z" />
        <path d="M-137.0 588.3A605 605 0 1 0 -222.4 -561.0L-181.7 -470.7A506 506 0 1 1 -110.1 493.0Z" />
      </g>
      <rect x="-142.5" y="-241.0" width="376" height="110" rx="55.0" />
      <rect x="-300.5" y="-55.5" width="616" height="110" rx="55.0" />
      <rect x="-159.5" y="130.0" width="389" height="110" rx="55.0" />
    </svg>
  );

  if (layout === "mark") {
    return <span className={cn(isWhite ? "text-brand-inverse" : "text-brand-navy", className)}>{mark}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center font-extrabold",
        layout === "stacked" ? "flex-col gap-2.5" : "gap-2.5",
        isWhite ? "text-brand-inverse" : "text-brand-navy",
        className,
      )}
      style={{ fontFamily: 'Figtree, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', letterSpacing: "-0.3px" }}
    >
      {mark}
      <span className={layout === "stacked" ? "text-2xl" : "text-xl"}>NairaPlate</span>
    </span>
  );
}