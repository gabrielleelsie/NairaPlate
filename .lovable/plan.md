# Paper-entry sales: food cost at the actual sale time

## The problem
When an owner approves a paper sale, its food cost is frozen using **today's** ingredient prices (the order-line rule fills in the cost when the line is created). A sale from last week should be costed at last week's prices.

## What changes
- On approval, each paper-sale line is costed with the ingredient prices **in force at the sale time**, using the new price history.
- If any ingredient's price at that time is unknown, NairaPlate does **not** guess. The owner sees "Food cost unknown at sale time" before approving, and chooses:
  - approve with today's cost, clearly labelled "estimated (today's prices)", or
  - hold the entry.
- The order details and the P&L show a small label on these lines: "Costed at sale time" or "Estimated — today's prices".
- Till sales are unchanged (they are sold now, so today's price is already correct).

## Safety
- Approved sales keep their frozen cost forever; nothing past is recalculated.
- No new browser access to price history; costing happens inside the existing approval function.
- No new permissions; same owner/Supa Admin-only approval.

## Technical details
- New DB function `recipe_plate_cost_at(version_id, business_id, at)` built on `ingredient_price_at`, returning cost + status (exact / unknown).
- `approve_and_post_late_entry` sets `cost_per_plate_kobo` explicitly plus a new `order_items.cost_basis` text column; the freeze trigger keeps a supplied value instead of overwriting it (late-entry posting only, via the existing `app.late_internal` flag).
- New read-only preview RPC for the owner review screen to show cost status before approval.
- Delivered as `supabase/external/20261105_late_entry_cost_at.sql` + check + self-undoing rehearsal + rollback, all run first on the practice database against the real schema, syntax and live function signatures before being sent.
- Prerequisite: `20261101_late_entries_a.sql` must be confirmed applied on the live database first (a check query will be included).
- UI: `/late-entries` review card and Orders line labels; `pnl.ts` already respects frozen costs.
