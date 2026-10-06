import { useCallback, useEffect, useRef, useState } from "react";
import { useBusinessProfile } from "@/lib/features";
import { listReceipts, receiptRoleAllowed, signedReceiptUrl, uploadReceipt, voidReceipt, type ReceiptRecordType, type ReceiptRow } from "@/lib/receipt-capture";
import { entryWhen } from "@/lib/catering-payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Optional photos for one saved record. Never blocks the record itself; hidden until photos are switched on. */
function ReceiptPhotosInner({ type, recordId, businessId, role, canAdd = true }: {
  type: ReceiptRecordType; recordId: string; businessId: string; role: string; canAdd?: boolean;
}) {
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const owner = role === "owner" || role === "supa_admin";
  const allowed = receiptRoleAllowed(role, type);

  const load = useCallback(async () => {
    const list = await listReceipts(type, recordId);
    setRows(list);
    if (!list) return;
    const pairs = await Promise.all(list.filter((r) => !r.deleted_at).map(async (r) => [r.id, await signedReceiptUrl(r.storage_path)] as const));
    setUrls(Object.fromEntries(pairs.filter(([, u]) => u) as [string, string][]));
  }, [type, recordId]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  if (!allowed || rows === null) return null;

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setMsg(null);
    try { await uploadReceipt({ businessId, type, recordId, file: f }); setMsg({ ok: true, text: "Photo added." }); await load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Photo not added." }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  const live = rows.filter((r) => !r.deleted_at);
  const voided = rows.filter((r) => r.deleted_at);

  return (
    <div className="space-y-2" data-testid="receipt-photos">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Photos ({live.length})</span>
        {canAdd && (
          <>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Adding photo…" : "Add photo"}</Button>
          </>
        )}
      </div>
      {live.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {live.map((r) => (
            <div key={r.id} className="space-y-1">
              {urls[r.id]
                ? <button type="button" onClick={() => setBig(urls[r.id] ?? null)} aria-label="Open photo"><img src={urls[r.id]} alt="Receipt photo" className="h-20 w-20 rounded border object-cover" /></button>
                : <div className="h-20 w-20 rounded border bg-muted" />}
              <div className="text-xs text-muted-foreground">{r.uploaded_by_name ?? "staff"} · {entryWhen(r.uploaded_at)}</div>
              {owner && (voidFor === r.id ? (
                <div className="space-y-1">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (5+ letters)" aria-label="Reason" />
                  <div className="flex gap-1">
                    <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={async () => {
                      setBusy(true); const err = await voidReceipt(r.id, reason); setBusy(false);
                      if (err) setMsg({ ok: false, text: err }); else { setVoidFor(null); setReason(""); await load(); }
                    }}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setVoidFor(null)}>Cancel</Button>
                  </div>
                </div>
              ) : <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => { setVoidFor(r.id); setReason(""); }}>Not valid</Button>)}
            </div>
          ))}
        </div>
      )}
      {voided.length > 0 && <p className="text-xs text-muted-foreground">{voided.length} photo{voided.length === 1 ? "" : "s"} marked not valid: {voided.map((v) => v.delete_reason).join("; ")}</p>}
      {msg && <p className={msg.ok ? "text-primary text-sm" : "text-destructive text-sm"} role="status">{msg.text}</p>}
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-2" onClick={() => setBig(null)} role="dialog" aria-label="Photo">
          <img src={big} alt="Receipt photo, full size" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

/** Receipt photos appear only when the kitchen's profile includes them. */
export function ReceiptPhotos(props: Parameters<typeof ReceiptPhotosInner>[0]) {
  const p = useBusinessProfile();
  if (p.loading || !p.has("receipt_capture")) return null;
  return <ReceiptPhotosInner {...props} />;
}
