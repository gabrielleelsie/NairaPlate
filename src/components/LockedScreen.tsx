import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { formatLagosDate } from "@/lib/subscription";

const WHATSAPP = "https://wa.me/2349124766666?text=" + encodeURIComponent("Hello NairaPlate, my plan has ended and I would like to renew.");

/** Shown to an owner / supa admin when the trial or paid plan has ended. Data is never deleted. */
export function LockedScreen({ businessName, endedAt, onSignOut }: { businessName: string | null; endedAt: string | null; onSignOut: () => void }) {
  return (
    <main className="np-public flex min-h-dvh items-center justify-center bg-home-surface px-4 py-10">
      <div className="w-full max-w-lg space-y-6 rounded-2xl bg-card p-6 shadow-sm sm:p-8">
        <Logo layout="inline" size={40} />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-brand-navy">Your NairaPlate plan has ended</h1>
          <p className="text-muted-foreground">
            {businessName ? <strong className="text-foreground">{businessName}</strong> : "Your business"}
            {endedAt ? ` had access until ${formatLagosDate(endedAt)}.` : " has no active plan."} Your records are safe and nothing has been deleted.
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold text-brand-navy">Choose a plan</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {["Monthly", "Quarterly", "Yearly"].map((p) => (
              <li key={p} className="rounded-lg border border-border p-3 text-center font-medium">{p}</li>
            ))}
          </ul>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          <li>Message us on WhatsApp and tell us the plan you want.</li>
          <li>Pay using the details we send you.</li>
          <li>We confirm your payment and switch your account back on.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="bg-brand-blue text-brand-inverse hover:bg-brand-blue/90">
            <a href={WHATSAPP} target="_blank" rel="noreferrer">Message us on WhatsApp</a>
          </Button>
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}
