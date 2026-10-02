// Catering order maths and rules, kept apart from the screen so they can be tested.
// All money is in kobo. The database repeats every one of these checks; this file is only so the screen can show the same answer first.
import { formatNaira } from "@/lib/costing";

export type OrderStatus = "enquiry" | "confirmed" | "delivered" | "cancelled";
export const STATUS_LABEL: Record<OrderStatus, string> = { enquiry: "Enquiry", confirmed: "Confirmed", delivered: "Delivered", cancelled: "Cancelled" };

export type DraftLine = { key: string; recipeId: string | null; name: string; quantity: number; unitPriceKobo: number; custom: boolean };

export const isOwnerRole = (role: string | null | undefined) => role === "owner" || role === "supa_admin";

export const lineTotal = (l: Pick<DraftLine, "quantity" | "unitPriceKobo">) => Math.round(l.unitPriceKobo * l.quantity);

export function orderTotals(o: { lines: DraftLine[]; deliveryKobo: number; discountKobo: number; depositKobo: number }) {
  const subtotal = o.lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = subtotal + o.deliveryKobo - o.discountKobo;
  return { subtotal, total, balance: total - o.depositKobo };
}

/** The first thing wrong with a draft order, in words a cashier understands, or null when it can be saved. */
export function draftProblem(o: {
  role: string | null; customer: string; date: string; time: string; today: string; lines: DraftLine[];
  deliveryKobo: number; discountKobo: number; depositKobo: number;
}): string | null {
  const t = orderTotals(o);
  if (!o.customer.trim()) return "Enter the customer name.";
  if (!o.date || !o.time) return "Enter the event date and time.";
  if (o.date < o.today) return "That date has already passed. Choose today or a later date.";
  if (o.lines.length === 0) return "Add at least one item.";
  if (o.lines.some((l) => !(l.quantity > 0))) return "Every item needs a quantity above zero.";
  if (o.lines.some((l) => l.custom && (!l.name.trim() || l.unitPriceKobo < 0))) return "A custom item needs a name and a price.";
  if (o.lines.some((l) => l.custom) && !isOwnerRole(o.role)) return "Only an owner can add an item that is not on the menu.";
  if (o.deliveryKobo < 0 || o.discountKobo < 0 || o.depositKobo < 0) return "Amounts cannot be negative.";
  if (o.discountKobo > 0 && !isOwnerRole(o.role)) return "Only an owner can give a discount.";
  if (o.discountKobo > t.subtotal) return "The discount cannot be more than the items total.";
  if (t.total <= 0) return "The order total must be more than zero.";
  if (o.depositKobo > t.total) return "The deposit cannot be more than the order total.";
  return null;
}

/** What the person at the till can do next with an order of this status. Cancel is for owners only. */
export function statusActions(status: OrderStatus, role: string | null | undefined): { to: "confirmed" | "delivered" | "cancelled"; label: string }[] {
  const out: { to: "confirmed" | "delivered" | "cancelled"; label: string }[] = [];
  if (status === "enquiry") out.push({ to: "confirmed", label: "Confirm order" });
  if (status === "confirmed") out.push({ to: "delivered", label: "Mark delivered" });
  if ((status === "enquiry" || status === "confirmed") && isOwnerRole(role)) out.push({ to: "cancelled", label: "Cancel order" });
  return out;
}

export const normaliseStatus = (s: unknown): OrderStatus => (s === "enquiry" || s === "delivered" || s === "cancelled" ? s : "confirmed");

export function totalsText(t: { subtotal: number; total: number; balance: number }, deliveryKobo: number, discountKobo: number, depositKobo: number): string {
  const parts = [`Items ${formatNaira(t.subtotal)}`];
  if (deliveryKobo > 0) parts.push(`delivery ${formatNaira(deliveryKobo)}`);
  if (discountKobo > 0) parts.push(`discount -${formatNaira(discountKobo)}`);
  parts.push(`total ${formatNaira(t.total)}`, `deposit ${formatNaira(depositKobo)}`, `still to pay ${formatNaira(Math.max(0, t.balance))}`);
  return parts.join(", ") + ".";
}
