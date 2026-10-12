// End of day: the ONE place the "Today's cash & sales" screen and the printable end-of-day slip get their numbers.
//
// Nothing here invents a figure. Total sales, cost of food, profit and food cost % come straight from
// calculateBusinessPnl() (the Profit & loss calculation). Cash in hand comes from the cash drawer's own
// figures (expectedDrawerCash() for an open shift, the saved close figures plus owner adjustments for a closed one).
// The sales lines (cash, transfers, credit, refunds) are a breakdown of the SAME orders, and are checked against
// the Profit & loss total: if they do not add up, `reconciles` is false and the screen and the slip say so.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "@/lib/costing";
import {
  SHIFT_COLUMNS,
  adjustedCount,
  adjustedDiscrepancy,
  expectedDrawerCash,
  normaliseAdjustments,
  normaliseShifts,
  type DrawerExpected,
  type ShiftAdjustment,
  type ShiftRow,
} from "@/lib/cash-drawer";
import { lostTransferKobo, receivedKobo, TRANSFER_LOST } from "@/lib/order-revenue";
import { calculateBusinessPnl, type DateRange, type PnlResult } from "@/lib/pnl";

/** Lines may differ from the Profit & loss total by this many kobo (rounding) before we say they do not add up. */
export const RECONCILE_TOLERANCE_KOBO = 1;

export type OrderMoneyRow = {
  id: string;
  status: string;
  payment_method?: string | null;
  total_kobo: unknown;
  cash_amount_kobo?: unknown;
  transfer_amount_kobo?: unknown;
};

const num = (x: unknown): number | null =>
  x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x);

/**
 * How the money on one counted order was received. cash + transfer + credit + other = what the Profit & loss counts for the order
 * before part-refunds. `other` is anything the order does not say (normally 0). A "transfer lost" paper sale counts only the cash it kept.
 */
export function splitOrderMoney(o: OrderMoneyRow): {
  cash: number;
  transfer: number;
  credit: number;
  other: number;
} {
  const received = receivedKobo(o);
  const cashA = num(o.cash_amount_kobo),
    transferA = num(o.transfer_amount_kobo);
  if (o.status === TRANSFER_LOST) {
    const cash = cashA ?? received;
    return { cash, transfer: 0, credit: 0, other: received - cash };
  }
  if (o.payment_method === "credit") return { cash: 0, transfer: 0, credit: received, other: 0 };
  let cash = cashA,
    transfer = transferA;
  if (cash === null && transfer === null) {
    if (o.payment_method === "cash") cash = received;
    else if (o.payment_method === "transfer") transfer = received;
  } else if (cash === null && transfer !== null) cash = received - transfer;
  else if (transfer === null && cash !== null) transfer = received - cash;
  const c = cash ?? 0,
    t = transfer ?? 0;
  return { cash: c, transfer: t, credit: 0, other: received - c - t };
}

export type SalesBlock = {
  total_kobo: number;
  paid_orders: number;
  cash_kobo: number;
  transfer_kobo: number;
  credit_kobo: number;
  other_kobo: number;
  refunds_kobo: number;
  /** Profit & loss total minus the lines' total. 0 when everything adds up. */
  gap_kobo: number;
  reconciles: boolean;
};

/** The sales lines for the counted orders, checked against the Profit & loss total. */
export function buildSalesBlock(
  orders: OrderMoneyRow[],
  refundedByOrder: Map<string, number>,
  pnl: Pick<PnlResult, "gross_sales_kobo" | "paid_orders">,
): SalesBlock {
  let cash = 0,
    transfer = 0,
    credit = 0,
    other = 0,
    refunds = 0;
  for (const o of orders) {
    const m = splitOrderMoney(o);
    cash += m.cash;
    transfer += m.transfer;
    credit += m.credit;
    other += m.other;
    refunds += refundedByOrder.get(o.id) ?? 0;
  }
  const linesTotal = cash + transfer + credit + other - refunds;
  const gap = pnl.gross_sales_kobo - linesTotal;
  return {
    total_kobo: pnl.gross_sales_kobo,
    paid_orders: pnl.paid_orders,
    cash_kobo: cash,
    transfer_kobo: transfer,
    credit_kobo: credit,
    other_kobo: other,
    refunds_kobo: refunds,
    gap_kobo: gap,
    reconciles: Math.abs(gap) <= RECONCILE_TOLERANCE_KOBO,
  };
}

/** The unpaid transfer of an order that is waiting to be confirmed. */
export function waitingTransferKobo(o: OrderMoneyRow): number {
  const transfer = num(o.transfer_amount_kobo);
  if (transfer !== null) return Math.max(0, transfer);
  const total = num(o.total_kobo) ?? 0,
    cash = num(o.cash_amount_kobo) ?? 0;
  return Math.max(0, total - cash);
}

export type ShiftBlock = {
  id: string;
  open: boolean;
  opened_at: string;
  closed_at: string | null;
  float_kobo: number;
  cash_sales_kobo: number;
  other_cash_kobo: number;
  payouts_kobo: number;
  expected_kobo: number | null;
  /** The count after owner adjustments. null when the shift is open or was closed without a count. */
  counted_kobo: number | null;
  difference_kobo: number | null;
};

/** One shift's cash block. For an open shift pass its expected cash so far. */
export function buildShiftBlock(
  shift: ShiftRow,
  adjustments: ShiftAdjustment[],
  openExpected?: DrawerExpected,
): ShiftBlock {
  if (shift.status === "open") {
    const e = openExpected;
    return {
      id: shift.id,
      open: true,
      opened_at: shift.opened_at,
      closed_at: null,
      float_kobo: Number(shift.opening_float_kobo),
      cash_sales_kobo: e?.cash_sales_kobo ?? 0,
      other_cash_kobo: (e?.catering_cash_kobo ?? 0) + (e?.debt_cash_kobo ?? 0),
      payouts_kobo: e?.payouts_kobo ?? 0,
      expected_kobo: e ? e.expected_cash_kobo : null,
      counted_kobo: null,
      difference_kobo: null,
    };
  }
  return {
    id: shift.id,
    open: false,
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    float_kobo: Number(shift.opening_float_kobo),
    cash_sales_kobo: shift.cash_sales_kobo ?? 0,
    other_cash_kobo: (shift.catering_cash_kobo ?? 0) + (shift.debt_cash_kobo ?? 0),
    payouts_kobo: shift.payouts_kobo ?? 0,
    expected_kobo: shift.expected_cash_kobo,
    counted_kobo: adjustedCount(shift, adjustments),
    difference_kobo: adjustedDiscrepancy(shift, adjustments),
  };
}

export type CashInHand = { kobo: number | null; counted: boolean; note: string };

/**
 * The headline cash in hand: the latest shift today. A closed, counted shift shows its counted cash. An open shift shows its expected cash
 * so far, "not yet counted". Shifts are not added together, because each one's float is usually the same cash carried over.
 */
export function cashInHand(shifts: ShiftBlock[]): CashInHand {
  const latest = [...shifts].sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
  if (!latest) return { kobo: null, counted: false, note: "No cash drawer shift today" };
  if (latest.open)
    return { kobo: latest.expected_kobo, counted: false, note: "Expected so far, not yet counted" };
  if (latest.counted_kobo === null)
    return { kobo: latest.expected_kobo, counted: false, note: "Shift closed without a count" };
  return { kobo: latest.counted_kobo, counted: true, note: "Counted at close" };
}

export type EndOfDay = {
  range: DateRange;
  asOf: string;
  pnl: PnlResult;
  sales: SalesBlock;
  shifts: ShiftBlock[];
  cash: CashInHand;
  transfers: { confirmed_kobo: number; waiting_kobo: number };
};

const COUNTED_STATUSES = ["paid", "partially_refunded", TRANSFER_LOST];

/** Reads today's figures. Throws on a failed read, like the Profit & loss does. */
export async function calculateEndOfDay(
  supabase: SupabaseClient,
  business_id: string,
  range: DateRange,
  now = new Date(),
): Promise<EndOfDay> {
  const from = range.from.toISOString(),
    to = range.to.toISOString();
  const [pnl, counted, waiting, refunds, drawers] = await Promise.all([
    calculateBusinessPnl(supabase, business_id, range),
    supabase
      .from("orders")
      .select("id,status,payment_method,total_kobo,cash_amount_kobo,transfer_amount_kobo")
      .eq("business_id", business_id)
      .in("status", COUNTED_STATUSES)
      .gte("created_at", from)
      .lt("created_at", to),
    supabase
      .from("orders")
      .select("id,status,payment_method,total_kobo,cash_amount_kobo,transfer_amount_kobo")
      .eq("business_id", business_id)
      .eq("status", "awaiting_payment")
      .gte("created_at", from)
      .lt("created_at", to),
    supabase
      .from("order_adjustments")
      .select("order_id,adjustment_amount_kobo")
      .eq("business_id", business_id)
      .eq("type", "partial_refund"),
    supabase
      .from("cash_drawers")
      .select(SHIFT_COLUMNS + ",business_id")
      .eq("business_id", business_id)
      .gte("opened_at", from)
      .lt("opened_at", to)
      .order("opened_at", { ascending: true }),
  ]);
  if (counted.error) throw new Error("Could not read today's orders.");
  if (waiting.error) throw new Error("Could not read orders waiting for a transfer.");
  if (drawers.error) throw new Error("Could not read today's cash drawer shifts.");
  // Same rule as the Profit & loss: no refunds table yet just means no refunds.
  const refundedByOrder = new Map<string, number>();
  for (const a of refunds.error ? [] : (refunds.data ?? []))
    refundedByOrder.set(
      a.order_id,
      (refundedByOrder.get(a.order_id) ?? 0) + Number(a.adjustment_amount_kobo),
    );

  const orders = (counted.data ?? []) as OrderMoneyRow[];
  const sales = buildSalesBlock(orders, refundedByOrder, pnl);

  const shiftRows = normaliseShifts(drawers.data as unknown[] | null);
  const closedIds = shiftRows.filter((s) => s.status === "closed").map((s) => s.id);
  let adjustments: ShiftAdjustment[] = [];
  if (closedIds.length) {
    const adj = await supabase
      .from("cash_drawer_adjustments" as never)
      .select("id,drawer_id,amount_kobo,reason,recorded_by_name,created_at")
      .in("drawer_id", closedIds);
    if (!adj.error) adjustments = normaliseAdjustments(adj.data as unknown[] | null);
  }
  const shifts: ShiftBlock[] = [];
  for (const s of shiftRows) {
    if (s.status === "open") {
      const e = await expectedDrawerCash(
        supabase,
        { id: s.id, business_id, opening_float_kobo: s.opening_float_kobo, opened_at: s.opened_at },
        now.toISOString(),
      );
      shifts.push(buildShiftBlock(s, adjustments, e));
    } else shifts.push(buildShiftBlock(s, adjustments));
  }

  const waitingKobo = ((waiting.data ?? []) as OrderMoneyRow[]).reduce(
    (sum, o) => sum + waitingTransferKobo(o),
    0,
  );
  return {
    range,
    asOf: now.toISOString(),
    pnl,
    sales,
    shifts,
    cash: cashInHand(shifts),
    transfers: { confirmed_kobo: sales.transfer_kobo, waiting_kobo: waitingKobo },
  };
}

// ---------- The slip: exact labels and values, so the screen, the print and the tests all read the same lines ----------

export type SlipRow = {
  label: string;
  value: string;
  note?: string;
  indent?: boolean;
  bold?: boolean;
};
export type SlipGroup = { heading?: string; rows: SlipRow[] };
export type SlipSection = { title: string; groups: SlipGroup[] };
export type Slip = {
  title: string;
  businessName: string;
  dateLine: string;
  sections: SlipSection[];
  warning: string | null;
  footer: string;
  checkedBy: string;
};

const minus = (kobo: number) => (kobo === 0 ? formatNaira(0) : `−${formatNaira(Math.abs(kobo))}`);

/** "Tuesday 13 October 2026, up to 8:47 pm (Nigeria time)" */
export function slipDateLine(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  })
    .format(now)
    .replace(/\s?(AM|PM)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, up to ${time} (Nigeria time)`;
}

const shiftHeading = (s: ShiftBlock) => {
  const t = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Africa/Lagos",
    })
      .format(new Date(iso))
      .replace(/\s?(AM|PM)$/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
  return s.open
    ? `Shift opened ${t(s.opened_at)}, still open`
    : `Shift opened ${t(s.opened_at)}, closed ${s.closed_at ? t(s.closed_at) : "later"}`;
};

function shiftRows(s: ShiftBlock): SlipRow[] {
  const diff = s.difference_kobo;
  const diffNote =
    diff === null ? undefined : diff === 0 ? "balanced" : diff < 0 ? "shortage" : "overage";
  return [
    { label: "Opening float", value: formatNaira(s.float_kobo) },
    { label: "+ Cash sales", value: formatNaira(s.cash_sales_kobo) },
    { label: "+ Catering cash / debt payments in cash", value: formatNaira(s.other_cash_kobo) },
    { label: "− Cash paid out of the drawer", value: minus(s.payouts_kobo) },
    {
      label: "Expected cash",
      value: s.expected_kobo === null ? "not available" : formatNaira(s.expected_kobo),
      bold: true,
    },
    s.open
      ? { label: "Counted cash", value: "shift still open, not counted" }
      : s.counted_kobo === null
        ? { label: "Counted cash", value: "not counted" }
        : { label: "Counted cash", value: formatNaira(s.counted_kobo), bold: true },
    {
      label: "Difference",
      value: diff === null ? "not available" : `${diff > 0 ? "+" : ""}${formatNaira(diff)}`,
      ...(diffNote ? { note: diffNote } : {}),
    },
  ];
}

/** Builds the slip. The profit lines are the Profit & loss figures untouched. */
export function buildSlip(eod: EndOfDay, businessName: string, now = new Date(eod.asOf)): Slip {
  const { sales, pnl } = eod;
  const salesRows: SlipRow[] = [
    {
      label: "Total sales",
      value: formatNaira(sales.total_kobo),
      note: `(${sales.paid_orders} paid order${sales.paid_orders === 1 ? "" : "s"})`,
      bold: true,
    },
    { label: "Cash received", value: formatNaira(sales.cash_kobo), indent: true },
    { label: "Bank transfers received", value: formatNaira(sales.transfer_kobo), indent: true },
    { label: "On credit (owed to you)", value: formatNaira(sales.credit_kobo), indent: true },
  ];
  if (sales.other_kobo !== 0)
    salesRows.push({
      label: "Not recorded by payment method",
      value: formatNaira(sales.other_kobo),
      indent: true,
    });
  salesRows.push({
    label: "Refunds and part-refunds",
    value: minus(sales.refunds_kobo),
    indent: true,
  });

  const cashGroups: SlipGroup[] = eod.shifts.length
    ? eod.shifts.map((s) => ({
        ...(eod.shifts.length > 1 ? { heading: shiftHeading(s) } : {}),
        rows: shiftRows(s),
      }))
    : [{ rows: [{ label: "No cash drawer shift today", value: "" }] }];

  return {
    title: "End-of-day slip",
    businessName,
    dateLine: slipDateLine(now),
    sections: [
      { title: "SALES", groups: [{ rows: salesRows }] },
      { title: "CASH IN HAND", groups: cashGroups },
      {
        title: "TRANSFERS",
        groups: [
          {
            rows: [
              { label: "Confirmed today", value: formatNaira(eod.transfers.confirmed_kobo) },
              { label: "Waiting to be confirmed", value: formatNaira(eod.transfers.waiting_kobo) },
            ],
          },
        ],
      },
      {
        title: "BASIC PROFIT",
        groups: [
          {
            rows: [
              {
                label: "Cost of food used (plates + wasted)",
                value: formatNaira(pnl.cost_of_goods_kobo),
              },
              {
                label: "Profit after food cost",
                value: formatNaira(pnl.gross_margin_kobo),
                bold: true,
              },
              {
                label: "Food cost as % of sales",
                value:
                  pnl.food_cost_percentage === null
                    ? "—"
                    : `${pnl.food_cost_percentage.toFixed(1)}%`,
              },
            ],
          },
        ],
      },
    ],
    warning: sales.reconciles
      ? null
      : `The sales lines do not add up to total sales (difference ${formatNaira(sales.gap_kobo)}). Do not rely on this slip until it has been checked.`,
    footer: "These are the same figures as the Profit & loss and Cash drawer screens.",
    checkedBy: "Checked by: ____________   Date: ____________",
  };
}
