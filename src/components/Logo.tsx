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
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className="shrink-0"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="3" />
      <path d="M13.5 29.5C17 32 20.4 33 24 33C28.1 33 31.8 31.7 35 29" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M17 26L23 20L28 24L36 15M30.5 15H36V20.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isWhite ? "text-brand-inverse" : "text-brand-blue"}
      />
    </svg>
  );

  if (layout === "mark") {
    return <span className={cn(isWhite ? "text-brand-inverse" : "text-brand-navy", className)}>{mark}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex font-bold tracking-normal",
        layout === "stacked" ? "flex-col items-center gap-1" : "items-center gap-2.5",
        isWhite ? "text-brand-inverse" : "text-brand-navy",
        className,
      )}
    >
      {mark}
      <span className={layout === "stacked" ? "text-2xl" : "text-xl"}>NairaPlate</span>
    </span>
  );
}