import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { formatLagosDate } from "@/lib/subscription";
import { formatPrice, renderTemplate } from "@/lib/platform-settings";
import { usePublicSettings } from "@/lib/use-public-settings";

const WHATSAPP_NUMBER = "2349124766666";

/** Shown to an owner / supa admin when the trial or paid plan has ended. Data is never deleted. */
export function LockedScreen({ businessName, endedAt, onSignOut }: { businessName: string | null; endedAt: string | null; onSignOut: () => void }) {
  // Prices and wording come from the platform admin's settings, with built-in text if none are set.
  const { prices, locked_screen: text } = usePublicSettings();
  const name = businessName ?? "Your business";
  const whatsapp = `https://wa.me/${WHATSAPP_NUMBER}?text=` + encodeURIComponent(renderTemplate(text.whatsapp_message, { business: name }));
  const planPrices: [string, number | null][] = [["Monthly", prices.monthly_kobo], ["Quarterly", prices.quarterly_kobo], ["Yearly", prices.yearly_kobo]];
  return (
    <main className="np-public flex min-h-dvh items-center justify-center bg-home-surface px-4 py-10">
      <div className="w-full max-w-lg space-y-6 rounded-2xl bg-card p-6 shadow-sm sm:p-8">
        <Logo layout="inline" size={40} />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-brand-navy">{text.title}</h1>
          <p className="text-muted-foreground">
            {renderTemplate(endedAt ? text.intro : text.intro_no_date, { business: name, date: endedAt ? formatLagosDate(endedAt) : "" })}
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold text-brand-navy">Choose a plan</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {planPrices.map(([p, kobo]) => (
              <li key={p} className="rounded-lg border border-border p-3 text-center font-medium">
                {p}
                {formatPrice(kobo) && <div className="mt-1 text-sm font-semibold text-brand-blue">{formatPrice(kobo)}</div>}
              </li>
            ))}
          </ul>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          {text.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90">
            <a href={whatsapp} target="_blank" rel="noreferrer">Message us on WhatsApp</a>
          </Button>
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
