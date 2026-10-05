import { Link } from "@tanstack/react-router";
import { useBusinessProfile, type FeatureName } from "@/lib/features";

/** Shows the screen only when the kitchen's profile includes it; otherwise a polite note. */
export function FeatureGate({ feature, children }: { feature: FeatureName; children: React.ReactNode }) {
  const p = useBusinessProfile();
  if (p.loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!p.has(feature)) {
    return (
      <main className="mx-auto max-w-md space-y-3 p-6">
        <p>This tool is not enabled for your kitchen profile. Contact your manager or support to turn it on.</p>
        <Link className="font-semibold text-brand-blue underline underline-offset-4" to="/app">Back to home</Link>
      </main>
    );
  }
  return <>{children}</>;
}
