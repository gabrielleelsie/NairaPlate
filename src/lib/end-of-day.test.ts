import { describe, expect, it } from "vitest";
import type { ShiftAdjustment, ShiftRow } from "./cash-drawer";
import {
  buildSalesBlock,
  buildShiftBlock,
  buildSlip,
  cashInHand,
  slipDateLine,
  splitOrderMoney,
  waitingTransferKobo,
  type EndOfDay,
  type OrderMoneyRow,
  type Slip,
  type SlipGroup,
  type SlipRow,
  type SlipSection,
} from "./end-of-day";
import { receivedKobo } from "./order-revenue";
import type { PnlResult } from "./pnl";

// Index helpers that fail loudly instead of returning undefined.
const sec = (s: Slip, n: number): SlipSection => {
  const x = s.sections[n];
  if (!x) throw new Error(`no section ${n}`);
  return x;
};
const grp = (s: Slip, n: number, g: number): SlipGroup => {
  const x = sec(s, n).groups[g];
  if (!x) throw new Error(`no group ${n}.${g}`);
  return x;
};
const rowAt = (s: Slip, n: number, g: number, k: number): SlipRow => {
  const x = grp(s, n, g).rows[k];
  if (!x) throw new Error(`no row ${n}.${g}.${k}`);
  return x;
};

const order = (o: Partial<OrderMoneyRow> & { id: string }): OrderMoneyRow => ({
  status: "paid",
  payment_method: "cash",
  total_kobo: 0,
  ...o,
});

// The same arithmetic the Profit & loss does for sales: what was received minus part-refunds, summed over the counted orders.
const pnlSales = (orders: OrderMoneyRow[], refunds: Map<string, number>) =>
  orders.reduce((s, o) => s + receivedKobo(o) - (refunds.get(o.id) ?? 0), 0);

describe("splitOrderMoney", () => {
  it("a cash order is all cash", () =>
    expect(
      splitOrderMoney(
        order({ id: "a", total_kobo: 100000, cash_amount_kobo: 100000, transfer_amount_kobo: 0 }),
      ),
    ).toEqual({ cash: 100000, transfer: 0, credit: 0, other: 0 }));
  it("a transfer order is all transfer", () =>
    expect(
      splitOrderMoney(
        order({
          id: "a",
          payment_method: "transfer",
          total_kobo: 135386,
          cash_amount_kobo: 0,
          transfer_amount_kobo: 135386,
        }),
      ),
    ).toEqual({ cash: 0, transfer: 135386, credit: 0, other: 0 }));
  it("a split order is cash and transfer", () =>
    expect(
      splitOrderMoney(
        order({
          id: "a",
          payment_method: "split",
          total_kobo: 110000,
          cash_amount_kobo: 40000,
          transfer_amount_kobo: 70000,
        }),
      ),
    ).toEqual({ cash: 40000, transfer: 70000, credit: 0, other: 0 }));
  it("a credit order is all credit", () =>
    expect(
      splitOrderMoney(
        order({
          id: "a",
          payment_method: "credit",
          total_kobo: 150000,
          cash_amount_kobo: 0,
          transfer_amount_kobo: 0,
        }),
      ),
    ).toEqual({ cash: 0, transfer: 0, credit: 150000, other: 0 }));
  it("an old cash order with no amounts saved counts as cash, and an old transfer order as transfer", () => {
    expect(splitOrderMoney(order({ id: "a", total_kobo: 50000 }))).toEqual({
      cash: 50000,
      transfer: 0,
      credit: 0,
      other: 0,
    });
    expect(
      splitOrderMoney(order({ id: "a", payment_method: "transfer", total_kobo: 50000 })),
    ).toEqual({ cash: 0, transfer: 50000, credit: 0, other: 0 });
  });
  it("a split order with one side missing takes the rest from the other side", () =>
    expect(
      splitOrderMoney(
        order({ id: "a", payment_method: "split", total_kobo: 100000, cash_amount_kobo: 30000 }),
      ),
    ).toEqual({ cash: 30000, transfer: 70000, credit: 0, other: 0 }));
  it("a split order with no amounts at all is not guessed: it is reported as not recorded by method", () =>
    expect(
      splitOrderMoney(order({ id: "a", payment_method: "split", total_kobo: 100000 })),
    ).toEqual({ cash: 0, transfer: 0, credit: 0, other: 100000 }));
  it("a transfer-lost paper sale counts only the cash it kept, and no transfer", () =>
    expect(
      splitOrderMoney(
        order({
          id: "a",
          status: "transfer_lost",
          payment_method: "split",
          total_kobo: 110000,
          cash_amount_kobo: 40000,
          transfer_amount_kobo: 70000,
        }),
      ),
    ).toEqual({ cash: 40000, transfer: 0, credit: 0, other: 0 }));
});

describe("the sales lines reconcile to total sales", () => {
  // The Demo Kitchen's real paid mix on 12 October: 4 cash, 2 split, 2 transfer, 1 credit.
  const orders: OrderMoneyRow[] = [
    order({ id: "c1", total_kobo: 60000, cash_amount_kobo: 60000, transfer_amount_kobo: 0 }),
    order({ id: "c2", total_kobo: 70000, cash_amount_kobo: 70000, transfer_amount_kobo: 0 }),
    order({
      id: "c3",
      total_kobo: 50000,
      cash_amount_kobo: 50000,
      transfer_amount_kobo: 0,
      status: "partially_refunded",
    }),
    order({ id: "c4", total_kobo: 55386, cash_amount_kobo: 55386, transfer_amount_kobo: 0 }),
    order({
      id: "s1",
      payment_method: "split",
      total_kobo: 110000,
      cash_amount_kobo: 40000,
      transfer_amount_kobo: 70000,
    }),
    order({
      id: "s2",
      payment_method: "split",
      total_kobo: 110000,
      cash_amount_kobo: 40000,
      transfer_amount_kobo: 70000,
    }),
    order({
      id: "t1",
      payment_method: "transfer",
      total_kobo: 70000,
      cash_amount_kobo: 0,
      transfer_amount_kobo: 70000,
    }),
    order({
      id: "t2",
      payment_method: "transfer",
      total_kobo: 65386,
      cash_amount_kobo: 0,
      transfer_amount_kobo: 65386,
    }),
    order({
      id: "cr",
      payment_method: "credit",
      total_kobo: 150000,
      cash_amount_kobo: 0,
      transfer_amount_kobo: 0,
    }),
  ];
  it("cash + transfers + credit - refunds equals the Profit & loss total", () => {
    const refunds = new Map([["c3", 12000]]);
    const total = pnlSales(orders, refunds);
    const b = buildSalesBlock(orders, refunds, {
      gross_sales_kobo: total,
      paid_orders: orders.length,
    });
    expect(b.cash_kobo).toBe(60000 + 70000 + 50000 + 55386 + 40000 + 40000);
    expect(b.transfer_kobo).toBe(70000 + 70000 + 70000 + 65386);
    expect(b.credit_kobo).toBe(150000);
    expect(b.refunds_kobo).toBe(12000);
    expect(b.cash_kobo + b.transfer_kobo + b.credit_kobo + b.other_kobo - b.refunds_kobo).toBe(
      total,
    );
    expect(b.gap_kobo).toBe(0);
    expect(b.reconciles).toBe(true);
    expect(b.total_kobo).toBe(total);
  });
  it("includes a transfer-lost sale the way the Profit & loss does (cash kept only)", () => {
    const lost = order({
      id: "l",
      status: "transfer_lost",
      payment_method: "split",
      total_kobo: 110000,
      cash_amount_kobo: 40000,
      transfer_amount_kobo: 70000,
    });
    const total = pnlSales([lost], new Map());
    expect(total).toBe(40000);
    const b = buildSalesBlock([lost], new Map(), { gross_sales_kobo: total, paid_orders: 1 });
    expect(b.cash_kobo).toBe(40000);
    expect(b.transfer_kobo).toBe(0);
    expect(b.reconciles).toBe(true);
  });
  it("says so when the lines do not add up, instead of forcing them to balance", () => {
    const b = buildSalesBlock(
      [order({ id: "x", total_kobo: 100000, cash_amount_kobo: 100000 })],
      new Map(),
      { gross_sales_kobo: 90000, paid_orders: 1 },
    );
    expect(b.gap_kobo).toBe(-10000);
    expect(b.reconciles).toBe(false);
  });
  it("allows a difference of 1 kobo, no more", () => {
    const o = [order({ id: "x", total_kobo: 100000, cash_amount_kobo: 100000 })];
    expect(
      buildSalesBlock(o, new Map(), { gross_sales_kobo: 100001, paid_orders: 1 }).reconciles,
    ).toBe(true);
    expect(
      buildSalesBlock(o, new Map(), { gross_sales_kobo: 100002, paid_orders: 1 }).reconciles,
    ).toBe(false);
  });
  it("a day with no sales is all zeros and reconciles", () => {
    const b = buildSalesBlock([], new Map(), { gross_sales_kobo: 0, paid_orders: 0 });
    expect(b).toMatchObject({
      total_kobo: 0,
      cash_kobo: 0,
      transfer_kobo: 0,
      credit_kobo: 0,
      refunds_kobo: 0,
      reconciles: true,
    });
  });
});

describe("waiting to be confirmed", () => {
  it("is the unpaid transfer part of an order awaiting payment", () => {
    expect(
      waitingTransferKobo(
        order({
          id: "w",
          status: "awaiting_payment",
          payment_method: "split",
          total_kobo: 110000,
          cash_amount_kobo: 40000,
          transfer_amount_kobo: 70000,
        }),
      ),
    ).toBe(70000);
    expect(
      waitingTransferKobo(
        order({
          id: "w",
          status: "awaiting_payment",
          payment_method: "transfer",
          total_kobo: 90000,
        }),
      ),
    ).toBe(90000);
    expect(
      waitingTransferKobo(
        order({
          id: "w",
          status: "awaiting_payment",
          payment_method: "split",
          total_kobo: 100000,
          cash_amount_kobo: 30000,
        }),
      ),
    ).toBe(70000);
  });
});

const shift = (o: Partial<ShiftRow> & { id: string }): ShiftRow => ({
  status: "closed",
  opened_at: "2026-10-13T07:00:00Z",
  closed_at: "2026-10-13T19:00:00Z",
  opened_by_name: "Cash",
  closed_by_name: "Cash",
  opening_float_kobo: 500000,
  closing_counted_kobo: 900000,
  expected_cash_kobo: 900000,
  discrepancy_kobo: 0,
  cash_sales_kobo: 400000,
  catering_cash_kobo: 0,
  debt_cash_kobo: 0,
  payouts_kobo: 0,
  forced: false,
  close_reason: null,
  ...o,
});

describe("shift blocks and cash in hand", () => {
  it("a closed shift shows its saved figures and the count after owner adjustments", () => {
    const adj: ShiftAdjustment[] = [
      {
        id: "a1",
        drawer_id: "s1",
        amount_kobo: 5000,
        reason: "found a note",
        recorded_by_name: "Owner",
        created_at: "2026-10-13T20:00:00Z",
      },
    ];
    const b = buildShiftBlock(
      shift({
        id: "s1",
        closing_counted_kobo: 895000,
        expected_cash_kobo: 900000,
        catering_cash_kobo: 20000,
        debt_cash_kobo: 10000,
        payouts_kobo: 30000,
      }),
      adj,
    );
    expect(b).toMatchObject({
      open: false,
      float_kobo: 500000,
      cash_sales_kobo: 400000,
      other_cash_kobo: 30000,
      payouts_kobo: 30000,
      expected_kobo: 900000,
      counted_kobo: 900000,
      difference_kobo: 0,
    });
  });
  it("an open shift uses its expected cash so far and has no count", () => {
    const b = buildShiftBlock(
      shift({
        id: "s2",
        status: "open",
        closed_at: null,
        closing_counted_kobo: null,
        expected_cash_kobo: null,
      }),
      [],
      {
        cash_sales_kobo: 120000,
        catering_cash_kobo: 5000,
        debt_cash_kobo: 0,
        payouts_kobo: 10000,
        expected_cash_kobo: 615000,
      },
    );
    expect(b).toMatchObject({
      open: true,
      expected_kobo: 615000,
      counted_kobo: null,
      difference_kobo: null,
      cash_sales_kobo: 120000,
      other_cash_kobo: 5000,
      payouts_kobo: 10000,
    });
  });
  it("headline: a counted closed shift shows the counted cash", () => {
    const c = cashInHand([buildShiftBlock(shift({ id: "s1" }), [])]);
    expect(c).toEqual({ kobo: 900000, counted: true, note: "Counted at close" });
  });
  it("headline: an open shift shows expected so far, labelled not yet counted", () => {
    const open = buildShiftBlock(
      shift({
        id: "s2",
        status: "open",
        closed_at: null,
        closing_counted_kobo: null,
        opened_at: "2026-10-13T15:00:00Z",
      }),
      [],
      {
        cash_sales_kobo: 0,
        catering_cash_kobo: 0,
        debt_cash_kobo: 0,
        payouts_kobo: 0,
        expected_cash_kobo: 500000,
      },
    );
    expect(cashInHand([buildShiftBlock(shift({ id: "s1" }), []), open])).toEqual({
      kobo: 500000,
      counted: false,
      note: "Expected so far, not yet counted",
    });
  });
  it("headline: shifts are not added together, the latest one is used", () => {
    const a = buildShiftBlock(
      shift({ id: "a", opened_at: "2026-10-13T07:00:00Z", closing_counted_kobo: 800000 }),
      [],
    );
    const b = buildShiftBlock(
      shift({ id: "b", opened_at: "2026-10-13T14:00:00Z", closing_counted_kobo: 750000 }),
      [],
    );
    expect(cashInHand([a, b]).kobo).toBe(750000);
  });
  it("headline: a closed shift without a count says so, and no shift says so", () => {
    expect(
      cashInHand([
        buildShiftBlock(shift({ id: "s", closing_counted_kobo: null, discrepancy_kobo: null }), []),
      ]).note,
    ).toBe("Shift closed without a count");
    expect(cashInHand([])).toEqual({
      kobo: null,
      counted: false,
      note: "No cash drawer shift today",
    });
  });
});

const pnl = (o: Partial<PnlResult> = {}): PnlResult => ({
  gross_sales_kobo: 500000,
  recipe_cost_of_goods_kobo: 150000,
  wastage_cost_kobo: 30000,
  cost_of_goods_kobo: 180000,
  gross_margin_kobo: 320000,
  food_cost_percentage: 36,
  paid_orders: 5,
  daily: [],
  warnings: [],
  limitations: [],
  by_dish: [],
  by_channel: [],
  ...o,
});
const eod = (o: Partial<EndOfDay> = {}): EndOfDay => ({
  range: { from: new Date("2026-10-12T23:00:00Z"), to: new Date("2026-10-13T23:00:00Z") },
  asOf: "2026-10-13T19:47:00Z",
  pnl: pnl(),
  sales: {
    total_kobo: 500000,
    paid_orders: 5,
    cash_kobo: 300000,
    transfer_kobo: 150000,
    credit_kobo: 100000,
    other_kobo: 0,
    refunds_kobo: 50000,
    gap_kobo: 0,
    reconciles: true,
  },
  shifts: [buildShiftBlock(shift({ id: "s1" }), [])],
  cash: { kobo: 900000, counted: true, note: "Counted at close" },
  transfers: { confirmed_kobo: 150000, waiting_kobo: 70000 },
  ...o,
});

describe("the slip", () => {
  it("dates the slip in Nigeria time, in the approved wording", () => {
    expect(slipDateLine(new Date("2026-10-13T19:47:00Z"))).toBe(
      "Tuesday 13 October 2026, up to 8:47 pm (Nigeria time)",
    );
    expect(slipDateLine(new Date("2026-10-13T08:05:00Z"))).toBe(
      "Tuesday 13 October 2026, up to 9:05 am (Nigeria time)",
    );
  });
  it("uses the approved headings, labels and order", () => {
    const s = buildSlip(eod(), "Demo Kitchen");
    expect(s.title).toBe("End-of-day slip");
    expect(s.sections.map((x) => x.title)).toEqual([
      "SALES",
      "CASH IN HAND",
      "TRANSFERS",
      "BASIC PROFIT",
    ]);
    expect(grp(s, 0, 0).rows.map((r) => r.label)).toEqual([
      "Total sales",
      "Cash received",
      "Bank transfers received",
      "On credit (owed to you)",
      "Refunds and part-refunds",
    ]);
    expect(grp(s, 1, 0).rows.map((r) => r.label)).toEqual([
      "Opening float",
      "+ Cash sales",
      "+ Catering cash / debt payments in cash",
      "− Cash paid out of the drawer",
      "Expected cash",
      "Counted cash",
      "Difference",
    ]);
    expect(grp(s, 2, 0).rows.map((r) => r.label)).toEqual([
      "Confirmed today",
      "Waiting to be confirmed",
    ]);
    expect(grp(s, 3, 0).rows.map((r) => r.label)).toEqual([
      "Cost of food used (plates + wasted)",
      "Profit after food cost",
      "Food cost as % of sales",
    ]);
    expect(s.footer).toBe(
      "These are the same figures as the Profit & loss and Cash drawer screens.",
    );
    expect(s.checkedBy).toBe("Checked by: ____________   Date: ____________");
  });
  it("the profit lines are the Profit & loss figures untouched", () => {
    const p = pnl({
      cost_of_goods_kobo: 123456,
      gross_margin_kobo: 654321,
      food_cost_percentage: 12.34,
      gross_sales_kobo: 777777,
    });
    const s = buildSlip(eod({ pnl: p, sales: { ...eod().sales, total_kobo: 777777 } }), "K");
    expect(rowAt(s, 3, 0, 0).value).toBe("₦1,234.56");
    expect(rowAt(s, 3, 0, 1).value).toBe("₦6,543.21");
    expect(rowAt(s, 3, 0, 2).value).toBe("12.3%");
    expect(rowAt(s, 0, 0, 0).value).toBe("₦7,777.77");
  });
  it("shows a dash for food cost % when there are no sales", () => {
    expect(
      rowAt(buildSlip(eod({ pnl: pnl({ food_cost_percentage: null }) }), "K"), 3, 0, 2).value,
    ).toBe("—");
  });
  it("counts the paid orders in the singular and the plural", () => {
    expect(
      rowAt(buildSlip(eod({ sales: { ...eod().sales, paid_orders: 1 } }), "K"), 0, 0, 0).note,
    ).toBe("(1 paid order)");
    expect(rowAt(buildSlip(eod(), "K"), 0, 0, 0).note).toBe("(5 paid orders)");
  });
  it("shows refunds as a minus amount", () =>
    expect(rowAt(buildSlip(eod(), "K"), 0, 0, 4).value).toBe("−₦500.00"));
  it("labels an open shift as not counted and a counted shift with its difference", () => {
    const open = buildShiftBlock(
      shift({ id: "o", status: "open", closed_at: null, closing_counted_kobo: null }),
      [],
      {
        cash_sales_kobo: 0,
        catering_cash_kobo: 0,
        debt_cash_kobo: 0,
        payouts_kobo: 0,
        expected_cash_kobo: 500000,
      },
    );
    const rows = grp(buildSlip(eod({ shifts: [open] }), "K"), 1, 0).rows;
    expect(rows.find((r) => r.label === "Counted cash")?.value).toBe(
      "shift still open, not counted",
    );
    const short = buildShiftBlock(
      shift({ id: "c", closing_counted_kobo: 890000, expected_cash_kobo: 900000 }),
      [],
    );
    const d = grp(buildSlip(eod({ shifts: [short] }), "K"), 1, 0).rows.find(
      (r) => r.label === "Difference",
    );
    expect(d).toMatchObject({ value: "−₦100.00", note: "shortage" });
  });
  it("gives each shift its own block, with a heading when there is more than one", () => {
    const a = buildShiftBlock(shift({ id: "a" }), []),
      b = buildShiftBlock(
        shift({ id: "b", opened_at: "2026-10-13T14:00:00Z", closed_at: "2026-10-13T20:00:00Z" }),
        [],
      );
    const groups = sec(buildSlip(eod({ shifts: [a, b] }), "K"), 1).groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]?.heading).toBe("Shift opened 8:00 am, closed 8:00 pm");
    expect(grp(buildSlip(eod(), "K"), 1, 0).heading).toBeUndefined();
  });
  it("says there was no shift when there was none", () => {
    expect(rowAt(buildSlip(eod({ shifts: [] }), "K"), 1, 0, 0).label).toBe(
      "No cash drawer shift today",
    );
  });
  it("carries a warning when the sales lines do not add up, and none when they do", () => {
    expect(buildSlip(eod(), "K").warning).toBeNull();
    const w = buildSlip(
      eod({ sales: { ...eod().sales, reconciles: false, gap_kobo: 10000 } }),
      "K",
    ).warning;
    expect(w).toBe(
      "The sales lines do not add up to total sales (difference ₦100.00). Do not rely on this slip until it has been checked.",
    );
  });
  it("adds a not-recorded line only when some sales have no payment method", () => {
    expect(
      grp(buildSlip(eod(), "K"), 0, 0).rows.some(
        (r) => r.label === "Not recorded by payment method",
      ),
    ).toBe(false);
    expect(
      grp(buildSlip(eod({ sales: { ...eod().sales, other_kobo: 10000 } }), "K"), 0, 0).rows.some(
        (r) => r.label === "Not recorded by payment method",
      ),
    ).toBe(true);
  });
});
