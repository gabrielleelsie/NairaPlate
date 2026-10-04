# Step 2: Dish selling-price history (before Phase 1 late entry)

Decisions taken from your answers:
- A price can start now or at a chosen future date and time (Lagos time).
- Only the owner or Supa Admin can set or schedule a price.
- History starts today: each dish's current price becomes its first record. Older sales keep the price stored on their own lines.
- The closed-shift policy for late cash is approved as you wrote it (used later, in Phase 1).

## What the owner will see
- On each dish: a "Price history" list showing the price, the date it started, the date it ended, and who set it.
- A "Set new price" box with "Start now" or "Start on (date and time)".
- A scheduled price shows as "Starts on ..." and can be cancelled before it starts. A price that has started can never be edited or deleted. To change it, set a new price.
- On the Till, nothing changes. It charges whatever price applies at that moment, and a scheduled price takes over by itself at its start time.

## Rules the database will enforce
- One price per dish at any moment. Periods never overlap and leave no gaps.
- History rows are add-only. Only "cancel a scheduled price that has not started" is allowed.
- Every sale function (cash, split, credit, transfer, catering) reads the price that applies at the time of the sale. Each sale line also records which history row it used.
- New function `dish_price_at(dish, time)`. Phase 1 will use it to price a late entry at the real sale time.
- Audit entries: `dish_price_scheduled`, `dish_price_started`, `dish_price_cancelled`.
- Every price write that already exists goes through the new history: recipe save, pricing approval, owner corrections, and variants. If any of these updated the price directly, history would go stale.

## Order of work
1. SQL script, check script, and undo script go in `supabase/external/`. You run them in your SQL editor, and I verify the results.
2. Then the code: owner price-history panel, Till/catering reading the new source, tests.
3. Update the UAT outline (price-history tests), the master spec, and roadmap.
4. Release only after the script is confirmed applied.

## Technical details
- New table `dish_prices(id, business_id, dish_id, price_kobo, effective_from, effective_to null, set_by, set_by_name, cancelled_at, created_at)`. dish_id is the stable id across recipe versions (`coalesce(dish_id, id)`). Server writes only, read by business staff through RLS with `business_has_access()`.
- Exclusion constraint (btree_gist) on `(dish_id, tstzrange(effective_from, effective_to))` where not cancelled.
- `set_dish_price(p_dish, p_price, p_from)`: checks owner/supa role and plan, closes the open period at p_from, and inserts the new row atomically.
- The `*_once` and catering functions switch from `recipes.selling_price_kobo` to `dish_price_at(dish, now())`. `order_items.dish_price_id` is added and filled.
- `recipes.selling_price_kobo` stays as a mirror of the current price, refreshed when prices change and when the Till reads them, so existing screens and P&L keep working.
- Backfill: one row per current dish, effective from the moment the script runs.
