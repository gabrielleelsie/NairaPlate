// "Chose a plan, not paid yet": stores whose owner picked a plan on the plan page and has not paid since. Platform admin only (the server checks).
import { Button } from "@/components/ui/button";
import { planText, type WaitingToPayItem } from "@/lib/plan-choice";

export type WaitingRow = WaitingToPayItem & { business_name: string; business_status: string | null; owner_email: string | null };

const STATUS: Record<string, string> = { pending: "Waiting for approval", approved: "Approved", suspended: "Suspended" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });

export function WaitingToPay({ items, onOpenStore }: { items: WaitingRow[]; onOpenStore?: ((businessId: string) => void) | undefined }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-brand-navy">Chose a plan, not paid yet</h2>
      {items.length === 0 && <p className="text-sm">Nobody is waiting to pay.</p>}
      {items.map((i) => (
        <div key={i.business_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <div className="space-y-1">
            <div className="font-semibold">{i.business_name} ({i.business_id})</div>
            <div className="text-muted-foreground">
              {i.owner_email ?? "no email"} · chose {planText({ mode: i.mode, term: i.term })} · {when(i.chosen_at)} · {STATUS[i.business_status ?? ""] ?? "Unknown"}
            </div>
          </div>
          {onOpenStore && <Button variant="outline" size="sm" onClick={() => onOpenStore(i.business_id)}>Open store</Button>}
        </div>
      ))}
    </section>
  );
}
