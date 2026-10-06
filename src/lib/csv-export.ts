// The ONE place accountant CSV files are shaped: escaping, money, Nigeria dates, column lists, file names and checksums.
// Exports are read-only. Column lists are versioned: change a list only together with its version tag.
import { lagosDateKey, LAGOS_OFFSET_MS } from "@/lib/lagos-time";

export type Cell = string | number | boolean | null | undefined;
export type CsvRow = Record<string, Cell>;

/** RFC-4180: quote when needed, double any quotes inside. */
export function csvEscape(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV text with the UTF-8 marker Excel needs, CRLF line ends, columns in the exact order given. */
export function toCsv(columns: readonly string[], rows: CsvRow[]): string {
  const lines = [columns.map(csvEscape).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Kobo to a plain decimal naira number such as 1450.00 or -25.50. No ₦ sign, no commas. */
export function koboToNaira(kobo: number | string | null | undefined): string {
  if (kobo === null || kobo === undefined || kobo === "") return "";
  const n = Math.round(Number(kobo));
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
export const koboInt = (kobo: number | string | null | undefined): string =>
  kobo === null || kobo === undefined || kobo === "" ? "" : String(Math.round(Number(kobo)));

/** Nigeria calendar date (YYYY-MM-DD) of a stored UTC timestamp. */
export const lagosDate = (iso: string | null | undefined): string => (iso ? lagosDateKey(new Date(iso)) : "");
/** Nigeria wall-clock time (HH:mm:ss) of a stored UTC timestamp. */
export const lagosTime = (iso: string | null | undefined): string =>
  iso ? new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS).toISOString().slice(11, 19) : "";
export const lagosDateTime = (iso: string | null | undefined): string => (iso ? `${lagosDate(iso)} ${lagosTime(iso)}` : "");

/** Whole days between two Nigeria dates (YYYY-MM-DD). */
export const daysBetween = (fromKey: string, toKey: string): number =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);

export type ReportId =
  | "sales_day_book" | "cash_drawer_summary" | "cash_paid_out_register" | "supplier_ledger"
  | "customer_ledger" | "refund_reversal_register" | "wastage_log" | "batch_production";

export const REPORT_SCHEMAS: Record<ReportId, { version: string; columns: readonly string[] }> = {
  sales_day_book: { version: "sales_day_book_v2", columns: [
    "lagos_date", "lagos_time", "order_ref", "order_id", "status", "channel", "payment_method",
    "subtotal_naira", "gross_sales_naira", "refunded_naira", "net_sales_naira", "net_sales_kobo",
    "cost_confidence", "is_late_entry", "actual_sold_at_lagos", "paper_reference", "receipt_attached", "receipt_count", "cashier_name", "created_at_utc"] },
  cash_drawer_summary: { version: "cash_drawer_summary_v1", columns: [
    "shift_id", "lagos_date", "shift_number", "opened_at_lagos", "closed_at_lagos", "opened_by", "closed_by", "status",
    "opening_float_naira", "opening_float_kobo", "cash_sales_naira", "catering_cash_naira", "debt_cash_naira", "payouts_naira",
    "expected_cash_naira", "closing_counted_naira", "discrepancy_naira", "owner_adjustments_naira", "final_adjusted_cash_naira",
    "final_discrepancy_naira", "is_owner_closed", "forced", "discrepancy_explanation"] },
  cash_paid_out_register: { version: "cash_paid_out_register_v2", columns: [
    "payout_id", "lagos_date", "lagos_time", "shift_id", "category", "amount_naira", "amount_kobo", "kind", "status",
    "reason_note", "receipt_attached", "receipt_count", "paid_by", "approved_by", "reversal_reason", "created_at_utc"] },
  supplier_ledger: { version: "supplier_ledger_v1", columns: [
    "supplier_id", "supplier_name", "phone", "opening_balance_naira", "purchases_on_credit_naira", "payments_made_naira",
    "reversals_naira", "closing_balance_naira", "closing_balance_kobo", "balance_0_30_days_naira", "balance_31_60_days_naira",
    "balance_61_90_days_naira", "balance_over_90_days_naira", "last_transaction_date_lagos"] },
  customer_ledger: { version: "customer_ledger_v1", columns: [
    "credit_id", "customer_name", "phone", "created_date_lagos", "original_credit_naira", "total_payments_naira",
    "total_writeoffs_naira", "balance_owed_naira", "balance_owed_kobo", "balance_0_30_days_naira", "balance_31_60_days_naira",
    "balance_61_90_days_naira", "balance_over_90_days_naira", "status", "last_payment_date_lagos", "order_id"] },
  refund_reversal_register: { version: "refund_reversal_register_v1", columns: [
    "event_id", "lagos_date", "lagos_time", "module", "action_type", "reference_id", "reversed_module", "reversed_record_id",
    "amount_naira", "amount_kobo", "remaining_refundable_naira", "reason", "authorized_by", "created_at_utc"] },
  wastage_log: { version: "wastage_log_v1", columns: [
    "wastage_id", "lagos_date", "lagos_time", "ingredient_name", "quantity", "unit", "unit_cost_naira",
    "total_cost_naira", "total_cost_kobo", "reason", "logged_by", "created_at_utc"] },
  batch_production: { version: "batch_production_v1", columns: [
    "batch_id", "lagos_date", "lagos_time", "recipe_name", "target_yield", "actual_portions", "ingredient_cost_naira",
    "packaging_cost_naira", "utility_cost_naira", "total_batch_cost_naira", "total_batch_cost_kobo", "realized_cost_per_plate_naira",
    "cost_source", "entry_kind", "reversal_status", "reversal_reason", "recorded_by", "created_at_utc"] },
};

export const MANIFEST_COLUMNS = [
  "report_name", "report_version", "file_name", "generated_at_lagos", "generated_by_user_id", "generated_by_display_name",
  "date_from_lagos", "date_to_lagos", "row_count", "amount_total_kobo", "checksum"] as const;

/** nairaplate_<report>_YYYY-MM-DD_to_YYYY-MM-DD_branch-all.csv */
export const exportFilename = (report: string, fromKey: string, toKey: string) =>
  `nairaplate_${report}_${fromKey}_to_${toKey}_branch-all.csv`;

/** A stable fingerprint of the file body (FNV-1a, 32-bit, hex) so an edited copy can be spotted. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Sum of a kobo column across rows, for the cover sheet. */
export const sumKoboColumn = (rows: CsvRow[], col: string | undefined) =>
  col ? rows.reduce((s, r) => s + (Number(r[col]) || 0), 0) : 0;

export async function downloadCsv(filename: string, text: string): Promise<void> {
  const { saveAs } = await import("file-saver");
  saveAs(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
}
