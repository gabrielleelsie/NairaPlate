import { supabase } from "@/lib/external-supabase";

export type ReceiptRecordType = "purchase" | "payout" | "supplier_payment" | "late_entry";
export type ReceiptRow = {
  id: string; storage_path: string; mime_type: string; caption: string | null; uploaded_by_name: string | null;
  uploaded_at: string; deleted_at: string | null; delete_reason: string | null;
};

export const RECEIPT_BUCKET = "receipts";
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_SIDE_PX = 1600;
export const JPEG_QUALITY = 0.8;
export const SIGNED_URL_SECONDS = 3600;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Same rule as the database function receipt_role_allowed. */
export function receiptRoleAllowed(role: string, type: ReceiptRecordType): boolean {
  if (role === "owner" || role === "supa_admin") return true;
  if (role === "purchaser") return type === "purchase" || type === "supplier_payment";
  if (role === "cashier") return type === "payout" || type === "late_entry";
  return false;
}

/** Plain-language reason a picked file cannot be used, or null if it is fine. */
export function fileProblem(f: { type: string; size: number }): string | null {
  if (!ALLOWED.has(f.type)) return "Please pick a photo (JPEG, PNG or WebP).";
  if (f.size <= 0) return "That photo is empty.";
  if (f.size > MAX_INPUT_BYTES) return "That photo is bigger than 10 MB.";
  return null;
}

/** New size that keeps the shape and fits inside MAX_SIDE_PX. */
export function fitSize(w: number, h: number, max = MAX_SIDE_PX): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Only paths the database will accept: <business>/<type>/<record>/<uuid>.jpg */
export function receiptPath(businessId: string, type: ReceiptRecordType, recordId: string, fileId: string): string {
  return `${businessId}/${type}/${recordId}/${fileId}.jpg`;
}

/** Shrinks and re-draws the photo as JPEG. Re-drawing also drops location and camera details. */
export async function compressReceiptImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This phone could not prepare the photo.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("This phone could not prepare the photo.");
  return { blob, width, height };
}

export function friendlyReceiptError(message: string): string {
  if (/fetch|network|Failed to/i.test(message)) return "No connection. The record is saved; add the photo again when you are online.";
  if (/row-level security|not allowed|permission/i.test(message)) return "You cannot add photos here.";
  return message;
}

/** Upload, then link. If linking fails, the uploaded file is removed so nothing is left behind. */
export async function uploadReceipt(args: { businessId: string; type: ReceiptRecordType; recordId: string; file: File; caption?: string }): Promise<void> {
  const problem = fileProblem(args.file);
  if (problem) throw new Error(problem);
  const { blob, width, height } = await compressReceiptImage(args.file);
  const path = receiptPath(args.businessId, args.type, args.recordId, crypto.randomUUID());
  const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(friendlyReceiptError(up.error.message));
  const { error } = await supabase.rpc("attach_receipt" as never, {
    p_record_type: args.type, p_record_id: args.recordId, p_storage_path: path, p_file_size_bytes: blob.size,
    p_mime_type: "image/jpeg", p_width_px: width, p_height_px: height, p_caption: args.caption?.trim() || null,
  } as never);
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    throw new Error(friendlyReceiptError(error.message));
  }
}

/** null means photos are not switched on yet (database not updated) — screens then show nothing. */
export async function listReceipts(type: ReceiptRecordType, recordId: string): Promise<ReceiptRow[] | null> {
  const { data, error } = await supabase.rpc("list_receipts" as never, { p_record_type: type, p_record_id: recordId } as never);
  if (error) return null;
  return (data ?? []) as ReceiptRow[];
}

export async function signedReceiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function voidReceipt(id: string, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc("void_receipt" as never, { p_receipt_id: id, p_reason: reason.trim() } as never);
  return error ? error.message : null;
}

/** Owner-only counts for exports; voided photos are not counted. Empty map if not available. */
export async function receiptCounts(type: ReceiptRecordType, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc("receipt_counts" as never, { p_record_type: type, p_record_ids: ids } as never);
  if (error) return out;
  for (const r of (data ?? []) as { record_id: string; receipt_count: number }[]) out.set(r.record_id, Number(r.receipt_count));
  return out;
}
