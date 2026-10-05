import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { durationLabel, watTime, type ConnStatus } from "@/lib/connectivity";

type Props = {
  status: ConnStatus;
  outageStartedAtUtc: string | null;
  menuSyncedAtUtc: string | null;
  menuStale: boolean;
  onPrintPaper: () => void;
};

export function OfflineBanner({ status, outageStartedAtUtc, menuSyncedAtUtc, menuStale, onPrintPaper }: Props) {
  const [now, setNow] = useState(Date.now());
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (status !== "offline") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const look = status === "offline"
    ? { cls: "border-destructive bg-destructive/10 text-destructive", Icon: WifiOff, text: "Offline — new transactions are not saved." }
    : status === "checking"
      ? { cls: "border-accent bg-accent/30 text-foreground", Icon: Loader2, text: "Checking connection…" }
      : { cls: "border-border bg-muted/40 text-muted-foreground", Icon: Wifi, text: "Connected." };

  return (
    <div role="status" aria-live="polite" className={`rounded-md border-2 p-3 space-y-2 ${look.cls}`}>
      <div className="flex items-center gap-2 font-semibold text-base">
        <look.Icon className={`h-5 w-5 shrink-0 ${status === "checking" ? "animate-spin" : ""}`} aria-hidden />
        <span>{look.text}</span>
        {status === "offline" && outageStartedAtUtc && <span className="font-normal text-sm">({durationLabel(outageStartedAtUtc, now)})</span>}
      </div>
      <p className="text-sm">
        Menu prices from {watTime(menuSyncedAtUtc)}.
        {menuStale && " These prices could be out of date."}
        {status === "offline" && menuStale && " Any price written on paper must be checked later."}
      </p>
      {status !== "online" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onPrintPaper}>Print paper fallback form</Button>
          <Button size="sm" variant="ghost" onClick={() => setHelp((h) => !h)}>What should I do?</Button>
        </div>
      )}
      {help && status !== "online" && (
        <ol className="list-decimal pl-5 text-sm space-y-1 text-foreground">
          <li>Do not charge a new sale in NairaPlate while the red bar is showing.</li>
          <li>Print or fill in the paper fallback form.</li>
          <li>Tell the owner if this lasts more than 15 minutes.</li>
        </ol>
      )}
      {status === "offline" && <p className="flex items-center gap-1 text-xs"><AlertTriangle className="h-3 w-3" aria-hidden /> Your current order is kept on this device.</p>}
    </div>
  );
}
