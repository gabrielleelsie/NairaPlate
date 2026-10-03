export type StepStatus = "untested" | "pass" | "fail" | "blocked";

export type UatStep = { action: string; expected: string };
export type UatCase = {
  id: string;
  title: string;
  module: "A" | "B" | "C";
  area: string;
  preconditions: string[];
  steps: UatStep[];
};

export const MODULES: Record<UatCase["module"], string> = {
  A: "Daily Owner Operations & Financial Control",
  B: "Price History, Costing & Exceptions",
  C: "Infrastructure, Backup & Disaster Recovery",
};

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
