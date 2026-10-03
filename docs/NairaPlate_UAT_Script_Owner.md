# NairaPlate UAT script: for the Owner

**Who this is for:** you, signed in as the Owner of the Demo Kitchen test business.
**How long:** about 60 minutes. You can stop after any part and carry on later.
**Where:** use the live app in a browser. Test business code: `demo-kitchen`. Everything you do is test data. Reversals are final, so use test entries only.

**How to use it:** do the steps in order. For each step, "Go to" tells you where to click, "Do" tells you what to do, and "You should see" is the pass condition. Tick **Pass** or **Fail**. If a step fails, write what you saw (the exact words of any message) in the margin next to the step and move on.

Menu names below are the ones on the app's home screen. The home screen groups them as **Sell**, **Buy & Stock**, **Kitchen** and **Oversight**. The "Home" link at the top of every screen takes you back.

---

## Part 0. Before you start (5 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 0.1 | Supabase, then SQL Editor | Paste the whole of `system_health_check.sql` and press Run | One row. The first eight columns read `0, 0, 0, 0, 0, 0, true, 8` | ☐ | ☐ |
| 0.2 | Supabase, then SQL Editor | Paste the whole of `rehearsal_demo_kitchen.sql` and press Run | A red error that starts "REHEARSAL DONE. NOTHING WAS SAVED. ALL CLEAR" with `findings=0, test_errors=0`. The red colour is normal: the error is the report | ☐ | ☐ |
| 0.3 | Cloudflare, then Workers and Pages, then nairaplate, then Deployments | Look at the newest deployment | It is green (succeeded) and came from the `main` branch | ☐ | ☐ |
| 0.4 | Supabase, then Database, then Backups | Look at the page | Backups, or Point in Time Recovery, are switched on | ☐ | ☐ |

## Part 1. Create the account for your first-time tester (3 minutes)

Do this once. It gives her a name and a PIN. This app has no emails or passwords: staff sign in with the **business code** and their own **PIN of 4 to 8 digits**.

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 1.1 | Open the app and sign in as yourself | Enter business code `demo-kitchen`, press **Continue**, tap your name, enter your PIN | The home screen with Sell, Buy & Stock, Kitchen and Oversight | ☐ | ☐ |
| 1.2 | Home, then **Oversight**, then **Staff** | Look at the **Add staff member** form | Fields: Name, Role, Starting PIN (4 to 8 digits) | ☐ | ☐ |
| 1.3 | Same form | Type the name `UAT Tester`. For **Role** pick **Cashier**. Press **Generate** next to the PIN | A 6-digit PIN appears on screen: "PIN: 123456 — tell UAT Tester this PIN. It won't be shown again." **Write it down now** | ☐ | ☐ |
| 1.4 | Same form | Press **Add staff member** | A confirmation, and "UAT Tester" appears under **Current staff** as "Cashier · Active" | ☐ | ☐ |

Write her sign-in details on the first-time-user script: business code `demo-kitchen`, name `UAT Tester`, and the PIN you wrote down. Do not send the PIN by any channel you would not use for a password. When testing is over, come back to **Staff**, find UAT Tester and press **Deactivate**.

## Part 2. Selling (Cashier work, done as Owner) (10 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 2.1 | Home, then **Sell**, then **Cash drawer** | If it says a shift is already open, stop and tell me. Otherwise type an **Opening float (₦)** of `2000` and press **Open shift** | The page now shows "Shift open since …" with a ₦2,000 float | ☐ | ☐ |
| 2.2 | Home, then **Sell**, then **Till** | Leave **Channel** as Walk-in and **Price tier** as Standard. Under **Item** choose a dish, set **Quantity** 1, press **Add** (or **Add item**) | The dish appears in the order with its price | ☐ | ☐ |
| 2.3 | Same screen | Under **Payment** pick **Cash**, then press the **Charge ₦…** button | A confirmation that the sale was saved | ☐ | ☐ |
| 2.4 | Home, then **Sell**, then **Orders** | Find the sale you just made | It shows as **Paid** | ☐ | ☐ |
| 2.5 | Same order | Press **Void / Refund**. Choose **Void**, type a reason such as `test sale, customer left` (at least 5 letters), press the **Void ₦…** button | The order now shows as **Voided** | ☐ | ☐ |
| 2.6 | Same screen, **Adjustments** tab | Look at the list | A "Void" line with your reason, who did it and when | ☐ | ☐ |
| 2.7 | **Till** | Make a second cash sale. Then in **Orders** press **Void / Refund** on it, choose **Part refund**, type an amount smaller than the total and a reason, press the refund button | The order shows as **Part refunded** and the Adjustments tab shows a "Part refund" line | ☐ | ☐ |
| 2.8 | **Till** | Make a sale with **Payment** set to **Customer credit (owe)**. Type a customer name `Test Customer` and a phone number | A confirmation that it was put on credit | ☐ | ☐ |
| 2.9 | Home, then **Sell**, then **Customer credit** | On the **Still owing** tab find Test Customer. Press **Record payment**, enter a smaller amount, choose Cash | The balance goes down by that amount | ☐ | ☐ |

## Part 3. Stock and money going out (15 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 3.1 | Home, then **Buy & Stock**, then **Ingredients** | Find **Garri** and write down its stock (about 5.2 kg when this script was written). You will compare later. Units that Garri understands are **derica** (1.2 kg) and **mudu** (1.5 kg): the **Units** button on its row shows them | A list with each ingredient's stock | ☐ | ☐ |
| 3.2 | Home, then **Kitchen**, then **Wastage** | Under **Ingredient** choose Garri, **Quantity** `1`, **Unit** derica, **Reason** Spoilage, press **Log wastage** | A message "Logged 1 derica of Garri … Stock has been reduced." | ☐ | ☐ |
| 3.3 | **Ingredients**, then **Stock trail** on that ingredient | Look at the newest line | A line for the wastage, reducing stock by 1.2 (one derica) | ☐ | ☐ |
| 3.4 | Home, then **Buy & Stock**, then **Purchases** | Fill in **Ingredient** Garri, **Quantity** `2`, **Unit** derica, **Total paid (₦)** `1700`, **Grade** B and **Season** Normal (both required), **Payment** Cash. Press **Submit purchase** | The purchase appears under **Recent purchases**. Garri stock goes up by 2.4 kg (two dericas) | ☐ | ☐ |
| 3.5 | Same list | On that purchase press **Reverse**. Type a reason of 5 or more characters, press **Reverse this purchase** | The purchase is marked as reversed and the stock goes back down | ☐ | ☐ |
| 3.6 | **Ingredients**, then **Edit** on one ingredient | Change **Price per kg (₦)** to a slightly higher number, choose **Grade this price is for** B and **Season it was bought in** Normal, press **Save** | The new price shows on the list, and the **History** button for that ingredient shows the change | ☐ | ☐ |
| 3.7 | Home, then **Buy & Stock**, then **Stock take** | Under **Count stock** type a **Counted** figure that differs from the system figure for one ingredient. In "Why is it different? (required)" type a reason. Press **Save count and correct stock** | The count is saved and the stock is corrected. It appears under **Recent counts** | ☐ | ☐ |

## Part 4. The cash drawer (5 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 4.1 | Home, then **Sell**, then **Cash drawer** | Under **Cash counted in drawer (₦)** type a figure close to float plus the cash sales you made (voided sales do not count) and press **Close shift** | "Shift closed", with the expected cash and how it was worked out (float, cash sales, and so on). A difference shows a note | ☐ | ☐ |
| 4.2 | Same page, **Closed shifts** | Find the shift you just closed and press **Correct the count**. Type a new count and a reason of 5 or more characters, press **Save adjustment** | The original count stays on screen, with your adjustment beside it | ☐ | ☐ |
| 4.3 | Home, then **Oversight**, then **Alerts** | Look at the list | If the count was different from expected, an alert about the difference is there | ☐ | ☐ |

## Part 5. Batches and the three Reverse buttons (20 minutes)

Use test entries only. Every reversal is final.

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 5.1 | Home, then **Kitchen**, then **Log a batch** | Under **Dish cooked** choose a dish. If it says "This dish is set to Made to order", choose a different dish. Leave **How many times the recipe** at `1`, type **Plates actually made** `10`, press **Save batch** | A "Saved:" summary with cost per plate | ☐ | ☐ |
| 5.2 | **Ingredients**, then **Stock trail** on an ingredient used by that dish | Look at the newest line | "Used in a batch", reducing stock | ☐ | ☐ |
| 5.3 | **Log a batch**, then scroll to **Recent batches** | Find the batch you just made. Press **Reverse**. Read the note. Type a reason of 5 or more characters. Press **Reverse this batch** | The batch is marked "Reversed" with your reason. A green message says the ingredients are back in stock | ☐ | ☐ |
| 5.4 | **Ingredients**, then **Stock trail** (same ingredient) | Look at the newest lines | A line "Batch reversed, put back" which cancels the earlier "Used in a batch" line. Stock is back to what it was before the batch | ☐ | ☐ |
| 5.5 | **Log a batch**, **Recent batches** | Look at the older batches from before 3 October (there are six) | Each has a **Reverse** button. Pressing it with a reason gives the message "This batch was recorded before reversals existed, so it cannot be reversed." That message is correct and expected | ☐ | ☐ |
| 5.6 | Home, then **Oversight**, then **Channel payouts** | Pick **Channel** Walk-in, keep the dates, type **Commission they took (₦)** `0` and **Amount that reached your bank (₦)** equal to the sales shown above, press **Save payout** | "Payout saved." It appears under **Past payouts** | ☐ | ☐ |
| 5.7 | Same page, **Past payouts** | On that payout press **Reverse**. Type fewer than 5 characters first: the **Reverse this payout** button stays greyed out. Then type a proper reason and press the button | The payout is faded, struck through and marked **Reversed**, with "Reversed by [your name] … It no longer counts." A green message says to record the correct payout | ☐ | ☐ |
| 5.8 | Same page | Look at the reversed payout | There is no **Reverse** button on it any more | ☐ | ☐ |
| 5.9 | Home, then **Buy & Stock**, then **Ingredients**, then **Edit** on an ingredient used by a dish | Raise the price noticeably (for example by a third) and press **Save** | The new price is saved | ☐ | ☐ |
| 5.10 | Home, then **Oversight**, then **Pricing review** (this opens the Recipes page, scroll to **Pricing review**) | Find the dish whose price is now more than 2% away from the suggestion | The dish appears with "Now ₦…" and "Suggested ₦…" and three buttons: **Publish**, **Adjust portion**, **Defer** | ☐ | ☐ |
| 5.11 | Same section | Press **Publish ₦…** | A message "price changed ₦… → ₦…". The new price shows | ☐ | ☐ |
| 5.12 | Same page, **Price decision history** | Find that decision (newest, "Published new price"). Press **Reverse**. Read the note: it says the price goes back to the old figure. Type a reason and press **Reverse this decision** | A message "Decision reversed. The dish price is back to ₦…". The decision is marked "(Reversed)" | ☐ | ☐ |
| 5.13 | **Recipes**, then the dish | Check the selling price | It is the old price again | ☐ | ☐ |
| 5.14 | **Pricing review**, history | Find an older "Published new price" decision from earlier days and press **Reverse** with a reason | Either it works, or you see "Not reversed: the dish price has changed since this decision, so it cannot be put back safely." Both are correct. Write down which you got | ☐ | ☐ |
| 5.15 | **Ingredients**, **Edit** | Put the ingredient price back to what it was in step 3.6 and press **Save** | Saved | ☐ | ☐ |

## Part 6. The record of what happened (5 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 6.1 | Home, then **Oversight**, then **Audit log** | Leave the dates on the last 7 days and look at the list | Lines for what you did today: order voided or refunded, cost changed, price published, and others | ☐ | ☐ |
| 6.2 | Same page | Look for lines about the payout, the price decision and the batch you reversed | Known issue: these three may show as plain code names (`payout_reversed`, `price_decision_reversed`, `batch_reversed`) instead of readable text. The lines should still be there with the reason in the description. Write down what you see | ☐ | ☐ |

## Part 7. Who can see what (10 minutes)

For each row, sign out first (the sign-out icon in the top bar of the home screen), then sign in again with `demo-kitchen` and pick the person from **Who's working?**. Use the existing Demo Kitchen staff, or the UAT Tester account.

| # | Sign in as | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 7.1 | A Cook (Kitchen Staff) | Look at the home screen | Only the Kitchen group (Recipes, Log a batch, Wastage, Stock take). No Till, no Purchases | ☐ | ☐ |
| 7.2 | The same Cook | Open **Log a batch**, then scroll to **Recent batches** | The list shows, but there is **no Reverse button** | ☐ | ☐ |
| 7.3 | A Cashier (or UAT Tester) | Look at the home screen | Only the Sell group (Till, Cash drawer, Orders, Customer credit) | ☐ | ☐ |
| 7.4 | The same Cashier | Open **Orders** and look at an order made by someone else | Pressing **Void / Refund** and trying gives "Only an owner can adjust another cashier's order" | ☐ | ☐ |
| 7.5 | A Purchaser | Look at the home screen | Only Buy & Stock. In **Purchases**, recent purchases have no **Reverse** button | ☐ | ☐ |

## Part 7b. Cash taken out of the drawer (15 minutes)

Do this with a shift open. If you closed it earlier, open a new one first (Home, then **Sell**, then **Cash drawer**, float `2000`, **Open shift**). The cashier steps (7b.1 to 7b.4) can be done signed in as the cashier or UAT Tester; the owner steps need you signed in as the Owner.

| # | Sign in as | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|---|
| 7b.1 | Cashier who opened the shift | Home, then **Sell**, then **Cash drawer** | Scroll to **Cash taken out**. Type **Amount (₦)** `4000`, **What for** Market run, **Note** `tomatoes and pepper`. Press **Take cash out** | "₦4,000.00 recorded as taken out of the drawer." It appears in the list as Recorded | ☐ | ☐ |
| 7b.2 | Same cashier | Same section | Take out another `4000` (**Gas or fuel**, note `gas refill for the stove`) | Recorded. The text above the form now says you can take out about ₦2,000 more | ☐ | ☐ |
| 7b.3 | Same cashier | Same section | Try `4000` again (**Transport**, note `bike to the market`). The button now says **Ask the owner**. Press it | A message that it is over your limit and is waiting for the owner. The list shows it as "Waiting for the owner" | ☐ | ☐ |
| 7b.4 | Same cashier | Same page | Look at the **Close shift** button | It is greyed out, with a red message: a cash payout is waiting for the owner | ☐ | ☐ |
| 7b.5 | Owner | **Cash drawer** | Find **Waiting for your approval**. Press **Decline**, type `no`: the **Decline this request** button stays greyed out. Then press **Approve** instead | The request becomes "Approved" and now counts as paid out | ☐ | ☐ |
| 7b.6 | Cashier | **Cash drawer** | Ask for another large amount, for example `9000` (Other, note `large item for the stove`) | It waits for the owner | ☐ | ☐ |
| 7b.7 | Owner | **Cash drawer** | Press **Decline**, type a reason such as `not needed on the shift`, press **Decline this request** | The request shows "Declined" with your reason and does not count | ☐ | ☐ |
| 7b.8 | Owner | **Cash drawer** | Take out `20000` yourself (**Supplier settlement**, note `settled the flour account`) | Recorded straight away with no approval step, because owners have no limit | ☐ | ☐ |
| 7b.9 | Owner | Same list | On that ₦20,000 payout press **Reverse**, type a reason, press **Reverse this payout** | It is struck through and marked Reversed. No Reverse button remains on it | ☐ | ☐ |
| 7b.10 | Owner | **Cash drawer**, **Cashier limit** box | Type `12000` and press **Save limit** | "The limit was changed." The label now says ₦12,000.00. Put it back to `10000` afterwards | ☐ | ☐ |
| 7b.11 | Purchaser | Home, then **Buy & Stock**, then **Purchases** | Log a purchase: **Payment** Cash. Tick **Paid from the cash drawer**. Submit | Saved. On the Cash drawer screen (as owner) a new payout "Purchase of …, paid from the drawer" appears | ☐ | ☐ |
| 7b.12 | Owner | **Purchases**, **Recent purchases** | Reverse that purchase with a reason | The purchase is reversed AND the payout on the Cash drawer screen shows as Reversed with the same reason | ☐ | ☐ |
| 7b.13 | Purchaser | Home, then **Buy & Stock**, then **Suppliers**, **Pay a supplier** | Pay a supplier `500`, tick **Paid from the cash drawer**, press **Record payment** | Saved. A payout "Payment to …, paid from the drawer" appears on the Cash drawer screen | ☐ | ☐ |
| 7b.14 | Purchaser | Same screen | Pay a supplier `100` with the box **not** ticked | Saved. No new payout appears | ☐ | ☐ |
| 7b.15 | Cashier | **Cash drawer** | Count the drawer: float, plus cash sales, minus everything taken out and approved (declined and reversed ones do not count). Type that in **Cash counted in drawer (₦)** and press **Close shift** | "Shift closed". The summary shows **Cash paid out of the drawer** and the shift is **Balanced** | ☐ | ☐ |
| 7b.16 | Owner | **Cash drawer**, **Closed shifts** | Look at the closed shift | The line shows "paid out ₦…" with the figures | ☐ | ☐ |
| 7b.17 | Cook or Purchaser | Open **Cash drawer** from the address bar if you can | The page says "Cashiers and owners only." | ☐ | ☐ |

### Catering deposit method

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 7b.18 | Owner or cashier: Home, then **Sell**, then **Catering** | Start a booking. Type a **Deposit paid (₦)** of `500`. Do not choose how it was paid yet | A new box **How was the deposit paid?** appears. The booking cannot be saved: the message says to choose cash or transfer | ☐ | ☐ |
| 7b.19 | Same booking | Choose **Cash** and book it | Booked. With a shift open, the cash deposit is counted in that shift's expected cash | ☐ | ☐ |

## Part 8. Final tidy-up

| # | Do | Pass | Fail |
|---|---|---|---|
| 8.1 | If you opened a shift and did not close it, close it now | ☐ | ☐ |
| 8.2 | When the first-time user has finished, go to **Oversight**, then **Staff**, find UAT Tester and press **Deactivate** | ☐ | ☐ |

## What to send me

For every Fail: the step number, what you did, what you saw, and the exact words of any message. Also send the outputs of steps 0.1 and 0.2. I will check the database side before changing anything.

**Sign-off:** I (name) ______________ ran this script on (date) ____________. Steps passed ____ of ____. Steps failed ____.
