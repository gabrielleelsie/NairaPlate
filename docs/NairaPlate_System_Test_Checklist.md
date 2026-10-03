# NairaPlate system test checklist

Use this in the Demo Kitchen business. It takes about 30 minutes. Do the parts in order. Write down what you see, and send me anything that does not match "Expect".

## Part 1. Run the two database scripts (about 3 minutes)

Both are in `supabase/external/`. Open the Supabase SQL editor, paste the file, press Run.

1. **`system_health_check.sql`** (read only). It returns one row. The first eight columns should be `0, 0, 0, 0, 0, 0, true, 8`. The last three are information only.
2. **`rehearsal_demo_kitchen.sql`** (changes nothing). It always ends with a red error. That error is the report, not a fault. The first line should say **ALL CLEAR** and `findings=0, test_errors=0`. The rows listed under it are information only (for example "Automatic transfers are not switched on for this shop").

If either differs, copy the result to me. Do not run anything else.

## Part 2. Sign in as each role (about 5 minutes)

| Sign in as | Try this | Expect |
|---|---|---|
| Cook | Open the menu | No Till, no Purchases, no Cash drawer |
| Cashier | Open the Cash drawer screen | You can open a shift; no "Reverse" buttons anywhere |
| Purchaser | Open Purchases | You can log a purchase; no "Reverse" button |
| Owner | Open Payouts, Pricing review, Log a batch | A "Reverse" button on entries |

## Part 3. The seven everyday flows as the Owner (about 15 minutes)

| # | Do this | Expect |
|---|---|---|
| 1 | **Sale then void.** Take a cash sale at the Till, then void it in Orders with a reason. | The sale appears, then shows as voided. Stock goes down, then comes back. |
| 2 | **Wastage.** Log some wastage of one ingredient. | Stock falls by that amount. |
| 3 | **Batch.** On "Log a batch", pick a dish set to "cooked in batches" and save. | A summary with cost per plate. The batch appears under "Recent batches". |
| 4 | **Stock take.** Count one ingredient and submit. | A cook's or purchaser's count waits for approval; as owner you can approve it. |
| 5 | **Price change.** Change an ingredient price on the Ingredients screen. | The cost updates and a "cost changed" line is written. |
| 6 | **Purchase.** Log a purchase of that ingredient. | Stock goes up. |
| 7 | **Drawer.** Open a shift, take a cash sale, close the shift with a count. | Expected cash is shown with how it was worked out. A difference raises an alert. |

## Part 4. The three new Reverse buttons as the Owner (about 10 minutes)

Use test entries only. Every reversal is final.

| Screen | Do this | Expect |
|---|---|---|
| **Payouts** | Click Reverse on a test payout, type a reason of 5 or more characters, confirm. | The original is struck through and marked "Reversed" with your reason. Typing fewer than 5 characters keeps the button disabled. |
| **Pricing review history** | Reverse a "Published new price" decision on a test dish. | A message says the price is back to the earlier figure. The dish shows that price. If you changed the price since, it is refused with a plain message. |
| **Log a batch, Recent batches** | Reverse the test batch from flow 3. | The batch is marked "Reversed". The ingredient stock is back to what it was before the batch (check the stock trail on the Ingredients screen: "Used in a batch" then "Batch reversed, put back"). |

Also check: after a reversal, the Reverse button is gone from that entry. An older batch from before 3 October shows a Reverse button, but pressing it says it was recorded before reversals existed.

## Part 5. Outside the app (about 2 minutes)

1. Cloudflare: Workers and Pages, then nairaplate, then Deployments. The newest deployment from `main` should be green.
2. Supabase: Database, then Backups. Confirm backups or point-in-time recovery are on.

## What to send me

For each failed row: the screen, what you did, what you saw, and the exact wording of any message. I will check the database side before changing anything.
