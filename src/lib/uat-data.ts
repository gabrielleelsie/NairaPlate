export type StepStatus = "untested" | "pass" | "fail" | "blocked";

export type UatStep = { action: string; expected: string };
export type UatCase = {
  id: string;
  title: string;
  module: "A" | "B" | "C" | "D";
  area: string;
  preconditions: string[];
  steps: UatStep[];
};

export const MODULES: Record<UatCase["module"], string> = {
  A: "Daily Owner Operations & Financial Control",
  B: "Price History, Costing & Exceptions",
  C: "Infrastructure, Backup & Disaster Recovery",
  D: "Offline Resilience — Safe Degraded Mode (Phase 0)",
};

const TILL = "Signed in to Demo Kitchen on the Till (cashier or owner), drawer open, menu loaded.";
const off = (n: number, title: string, area: string, preconditions: string[], steps: UatStep[]): UatCase => ({
  id: `UAT-OFF-${String(n).padStart(2, "0")}`, title, module: "D", area, preconditions, steps,
});

export const OFFLINE_CASES: UatCase[] = [
  off(1, "Normal online cash sale", "Save once", [TILL], [
    { action: "Add two dishes, choose Cash, enter cash received and press Charge.", expected: "Sale saves once and carries a sale code." },
    { action: "Check Orders for this sale.", expected: "Exactly one order; the Till draft clears only after the save is confirmed." },
  ]),
  off(2, "Double-tap Charge", "Save once", [TILL], [
    { action: "Build a sale and tap Charge twice quickly.", expected: "Only one order is created." },
    { action: "Check Orders.", expected: "The second tap returns the original sale; no duplicate." },
  ]),
  off(3, "Connection drops before submit", "Offline lockout", [TILL], [
    { action: "Build a sale, then turn on airplane mode.", expected: "Red offline warning shows; Charge is disabled." },
    { action: "Check the Till and Orders after reconnecting.", expected: "Draft is still there; no sale was created." },
  ]),
  off(4, "Connection drops during submit", "Uncertain save", [TILL], [
    { action: "Press Charge and cut the connection immediately.", expected: "\"Checking sale status…\" appears; the draft is locked." },
    { action: "Try to start or charge another sale.", expected: "Blocked until the first sale's status is confirmed." },
  ]),
  off(5, "Server saved sale but browser timed out", "Uncertain save", ["As UAT-OFF-04, where the sale reached the server."], [
    { action: "Reconnect and press Check again.", expected: "The original sale is found; no duplicate order." },
    { action: "Check the Till.", expected: "Draft clears only after the sale is confirmed." },
  ]),
  off(6, "Server did not save sale", "Uncertain save", ["As UAT-OFF-04, where the sale did not reach the server."], [
    { action: "Reconnect and press Check again.", expected: "Sale reported as not saved; cashier may retry." },
    { action: "Retry Charge, then check Orders.", expected: "Exactly one sale is created." },
  ]),
  off(7, "Browser refresh during an unsaved draft", "Drafts", [TILL], [
    { action: "Build a split sale with several items and quantities, then refresh.", expected: "Items, quantities, payment method and split amounts restore correctly." },
  ]),
  off(8, "Credit-sale draft refresh", "Drafts & privacy", [TILL], [
    { action: "Build a credit sale with customer name and phone, then refresh.", expected: "Name and phone restore." },
    { action: "Discard the draft (and separately, let one expire).", expected: "Customer name and phone are removed from the device." },
  ]),
  off(9, "Cash / transfer / split draft refresh", "Drafts & privacy", [TILL], [
    { action: "Build cash, transfer and split drafts and refresh each.", expected: "No customer personal details are kept on the device." },
  ]),
  off(10, "Browser restart during outage", "Drafts", [TILL], [
    { action: "Build a sale offline, close the browser fully, reopen the Till.", expected: "Recoverable draft is offered and clearly marked as not a saved sale." },
  ]),
  off(11, "Paper fallback", "Paper form", [TILL], [
    { action: "While offline, print the paper fallback form.", expected: "All fields print, including the paper reference." },
    { action: "Read the printed form.", expected: "It visibly says it is not a saved NairaPlate sale." },
  ]),
  off(12, "Connection returns", "Connection status", [TILL], [
    { action: "Go offline, then turn the connection back on.", expected: "Banner moves offline → checking → online." },
    { action: "Watch when Charge re-enables.", expected: "Only after a successful server check, not just the phone saying it is online." },
  ]),
  off(13, "Existing sale code reused", "Save once", ["Tester can resend a sale with a code already used by this business."], [
    { action: "Resend the same sale code for the same business.", expected: "The original order is returned; no new sale." },
  ]),
  off(14, "Another business tries the same code", "Business separation", ["A second test business and a sale code used by Demo Kitchen."], [
    { action: "From the second business, check and submit the same code.", expected: "It cannot see or affect Demo Kitchen's sale." },
  ]),
  off(15, "Expired draft", "Drafts", ["A Till draft older than 24 hours."], [
    { action: "Open the Till.", expected: "Draft is not submitted on its own." },
    { action: "Choose an action.", expected: "Cashier can discard it (with reason) or hand it to the owner." },
  ]),
];

export const OFFLINE_RELEASE_RULES = [
  "No duplicate sale is created.",
  "No draft is falsely shown as saved.",
  "A cashier understands what to do during an uncertain submission.",
  "No customer data is unnecessarily retained.",
  "The health check and full rehearsal remain clean afterwards.",
];

export const UAT_CASES: UatCase[] = [
  {
    id: "UAT-OWN-01",
    title: "Cash Payouts & Drawer Controls",
    module: "A",
    area: "Cash control",
    preconditions: [
      "Signed in to Demo Kitchen as the Owner.",
      "A cashier account exists and a cash drawer is open with a known opening float.",
    ],
    steps: [
      { action: "Open the cash drawer screen and check the opening float.", expected: "Opening float matches the amount entered when the drawer was opened." },
      { action: "Record a cash payout without a reason.", expected: "Save is refused; a reason is mandatory." },
      { action: "Record a ₦5,000 payout with a reason, then try to edit or delete it.", expected: "Payout saves; it cannot be edited or deleted (append-only)." },
      { action: "As the cashier, record a payout above ₦10,000.", expected: "Payout is blocked until the Owner approves with their PIN." },
      { action: "Approve the over-limit payout with the Owner PIN.", expected: "Payout saves and records who approved it." },
      { action: "Check the drawer's expected cash.", expected: "Expected cash = float + cash sales − payouts, to the naira." },
    ],
  },
  {
    id: "UAT-OWN-02",
    title: "Transfer Confirmation & Monnify Webhooks",
    module: "A",
    area: "Payments",
    preconditions: ["Monnify sandbox credentials configured on staging.", "An open order awaiting transfer payment."],
    steps: [
      { action: "Simulate a bank transfer for the order.", expected: "A payment notification is received and logged." },
      { action: "Send an exact-amount payment.", expected: "Order is matched and marked paid." },
      { action: "Send a short payment (less than the order total).", expected: "Order stays unpaid and a short-payment alert is raised." },
      { action: "Resend the same webhook notification.", expected: "Duplicate is rejected; no second payment recorded." },
      { action: "Check the order and stock after a full payment.", expected: "Order status is 'Paid' and ingredient stock is reduced." },
    ],
  },
  {
    id: "UAT-OWN-03",
    title: "Shift Close & Every-Naira-Explained Reconciliation",
    module: "A",
    area: "Shift close",
    preconditions: ["A shift with sales, payouts and stock movements has taken place."],
    steps: [
      { action: "Run the end-of-shift summary.", expected: "Summary lists sales by payment method, payouts and expected cash." },
      { action: "Enter the counted cash.", expected: "Difference between expected and counted cash is shown to the naira." },
      { action: "Review stock alerts on the summary.", expected: "Missing or low stock items are flagged." },
      { action: "Log an explanation for the variance and close the shift.", expected: "Explanation is saved with the closed shift and visible to the Owner." },
    ],
  },
  {
    id: "UAT-OWN-04",
    title: "Effective-Dated Ingredient & Selling Price History",
    module: "B",
    area: "Costing",
    preconditions: ["A dish with past sales exists."],
    steps: [
      { action: "Change the dish's selling price.", expected: "New price applies to new sales only; price history records the change and date." },
      { action: "Open the profit report for a period before the change.", expected: "Past sales keep the plate cost and price from the moment of sale." },
      { action: "Raise an ingredient's market price so the margin drops below target.", expected: "A cost-drift alert is raised for the affected dish." },
    ],
  },
  {
    id: "UAT-OWN-05",
    title: "Daily Exception Intelligence Dashboard",
    module: "B",
    area: "Exceptions",
    preconditions: ["The day includes a short shift, a void/refund and an unapproved payout."],
    steps: [
      { action: "Generate the daily summary.", expected: "Summary is produced for the chosen date." },
      { action: "View flagged short shifts.", expected: "Short shift appears with the amount and staff name." },
      { action: "View voids and refunds.", expected: "Unauthorised voids/refunds are flagged." },
      { action: "View unapproved payouts.", expected: "Payouts without approval are listed." },
      { action: "Mark exceptions as acknowledged.", expected: "Exceptions show as acknowledged with who and when." },
    ],
  },
  {
    id: "UAT-OWN-06",
    title: "Supabase Database Restoration & Verification Drill",
    module: "C",
    area: "Disaster recovery",
    preconditions: ["Access to a Supabase scratch project and staging credentials.", "NEVER restore over production/live."],
    steps: [
      { action: "In Supabase Dashboard → Database → Backups, locate the latest daily snapshot or PITR timestamp.", expected: "Latest snapshot/PITR timestamp is identified and recorded." },
      { action: "Restore the snapshot into a separate scratch/test project.", expected: "Restore completes in the scratch project; live is untouched." },
      { action: "Run system_health_check.sql on the restored database.", expected: "Health check returns success and matches live configuration." },
      { action: "Count rows in orders, order_lines, purchases, cash_drawers, payouts, audit_lines.", expected: "Row counts strictly match the live database at snapshot time." },
      { action: "Run rehearsal_demo_kitchen.sql on the scratch copy.", expected: "Rehearsal output returns \"ALL CLEAR\"." },
      { action: "Record Recovery Point (data-loss window) and Recovery Time (minutes to restore).", expected: "RPO and RTO are documented in the test log." },
    ],
  },
];

export type StepResult = { actual: string; status: StepStatus };
export type DrillMetrics = { rpo: string; rto: string; queryResults: string };
