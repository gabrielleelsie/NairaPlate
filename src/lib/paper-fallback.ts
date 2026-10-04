// Printable paper fallback form for the Till. Opens a print window; nothing is saved to NairaPlate.
import { formatNaira } from "./costing";

export type PaperInput = {
  reference: string;
  businessName: string;
  tillLabel: string;
  cashierName: string;
  shiftOpenedWat: string | null;
  printedAtWat: string;
  draftLines: { name: string; quantity: number; priceKobo: number }[];
  menuStale: boolean;
  /** Set for an expired draft: heading and extra warning. */
  expired?: { ownerReview: boolean; createdWat: string | null; lastEditedWat: string };
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const line = (label: string, value = "") => `<div class="row"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;
const box = (label: string) => `<span class="cb">&#9744; ${esc(label)}</span>`;

export function paperFormHtml(p: PaperInput): string {
  const rows = p.draftLines.length
    ? p.draftLines.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${esc(formatNaira(l.priceKobo))}</td><td></td></tr>`).join("")
    : "";
  const blanks = Array.from({ length: Math.max(0, 8 - p.draftLines.length) }, () => "<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>").join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.reference)}</title><style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:18px;color:#000}
  h1{font-size:16px;margin:0 0 4px} .warn{border:2px solid #000;padding:6px;font-weight:bold;margin:8px 0;text-align:center}
  .row{display:flex;gap:8px;margin:6px 0;align-items:flex-end}.lbl{white-space:nowrap}.val{flex:1;border-bottom:1px solid #000;min-height:14px}
  table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #000;padding:4px;text-align:left}th{background:#eee}
  .cb{margin-right:14px;white-space:nowrap}.sec{margin-top:10px;font-weight:bold}.note{font-size:10px}
  </style></head><body>
  <h1>${p.expired?.ownerReview ? "NairaPlate owner review request: expired draft" : "NairaPlate paper fallback form"}</h1>
  <div class="warn">This form is not a saved NairaPlate sale.</div>
  ${p.expired ? `<div class="warn">EXPIRED — NOT SAVED. Unconfirmed draft. No order, payment, stock movement or cash-drawer entry was created from it.</div>
  ${line("Draft created", p.expired.createdWat ?? "unknown")}${line("Draft last edited", p.expired.lastEditedWat)}` : ""}
  ${line("13. Paper reference", p.reference)}
  ${line("1. Outlet / business", p.businessName)}
  ${line("2. Till", p.tillLabel)}
  ${line("3. Cashier", p.cashierName)}
  ${line("14. Shift opened", p.shiftOpenedWat ?? "")}
  ${line("4. Time of sale (printed " + p.printedAtWat + ")")}
  ${line("5. Paper sequence no.", p.reference.split("-").pop() ?? "")}
  <div class="sec">6. Items${p.draftLines.length ? " (unconfirmed draft)" : ""}</div>
  ${p.menuStale ? '<p class="note">Menu prices may be out of date. Every price here must be checked later.</p>' : ""}
  <table><tr><th>Dish</th><th>Qty</th><th>Plate price</th><th>Line total</th></tr>${rows}${blanks}</table>
  ${line("Total")}
  <div class="sec">7. Payment</div><p>${box("Cash")}${box("Transfer pending")}${box("Split")}</p>
  ${line("8. Cash amount")}${line("8. Transfer amount")}
  ${line("15. Cash received")}${line("15. Change given")}
  ${line("9. Customer name")}${line("9. Customer phone")}
  <div class="sec">10. Why paper was used</div><p>${box("Network outage")}${box("Power outage")}${box("Device fault")}${box("Other:")}</p>
  ${line("11. Staff signature / initials")}
  ${line("12. Owner approval for later entry")}
  <div class="sec">16. Late-entry outcome (owner fills in later)</div>
  <p>${box("Posted to NairaPlate")}${box("Rejected")}${box("Duplicate of recorded sale")}${box("Transfer pending")}${box("Unable to verify")}</p>
  <p class="note">The paper reference is counted on this device only. It is not guaranteed unique across tills.</p>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`;
}

export function printPaperForm(p: PaperInput): boolean {
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(paperFormHtml(p));
  w.document.close();
  return true;
}
