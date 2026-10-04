# NairaPlate UAT script: for the Owner

**Version 1.3, 4 October 2026.** Matches Master Specification version 1.3.

**Who this is for:** you, signed in as the Owner of the Demo Kitchen test business.
**How long:** about 90 minutes for Parts 0 to 7b, which run on the live site today. Modules D, E and F take longer and can only be run after the offline, paper-entry and price-history screens are released (see the box below). You can stop after any part and carry on later.
**Where:** use the live app in a browser. Test business code: `demo-kitchen`. Everything you do is test data. Reversals are final, so use test entries only.

**How to use it:** do the steps in order. For each step, "Go to" tells you where to click, "Do" tells you what to do, and "You should see" is the pass condition. Tick **Pass** or **Fail**. If a step fails, write what you saw (the exact words of any message) in the margin next to the step and move on.

**Which parts can you run today?** Parts 0 to 7b and Part 8 work on the live site now. **Modules D, E and F are not runnable yet.** Their screens are in the source branch and not on the live site. Before they are released: (1) the permission fix `20261102_hygiene_after_late_entries.sql` must be applied (Master Specification R1); (2) the paper-entry defects D1 to D4 and D6 must be fixed (Part 9 of the specification); (3) the rehearsal `rehearsal_phase0_prices.sql` must be run and clean. Tests marked **Known defect** in Module E are expected to fail until their defect is fixed; they are there so the fix can be proved.

Menu names below are the ones on the app's home screen. The home screen groups them as **Sell**, **Buy & Stock**, **Kitchen** and **Oversight**. The "Home" link at the top of every screen takes you back.

---

## Part 0. Before you start (5 minutes)

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 0.1 | Supabase, then SQL Editor | Paste the whole of `system_health_check.sql` and press Run | One row. The first eight columns read `0, 0, 0, 0, 0, 0, true, 8`. **Known issue until the permission fix is applied:** the second, third and fourth values read `21, 9, 2` (Master Specification R1). That is the known issue, not a new fault; any other number is a Fail | ☐ | ☐ |
| 0.2 | Supabase, then SQL Editor | Paste the whole of `rehearsal_demo_kitchen.sql` and press Run | A red error that starts "REHEARSAL DONE. NOTHING WAS SAVED. ALL CLEAR" with `findings=0, test_errors=0` (200 steps passed on 3 October; the number may be higher after later additions). The red colour is normal: the error is the report | ☐ | ☐ |
| 0.3 | Cloudflare, then Workers and Pages, then nairaplate, then Deployments | Look at the newest deployment | It is green (succeeded) and came from the `main` branch | ☐ | ☐ |
| 0.4 | Supabase, then Database, then Backups | Look at the page | Backups, or Point in Time Recovery, are switched on | ☐ | ☐ |

| 0.5 | Supabase, then SQL Editor | Before releasing the offline, price-history and paper-entry screens only: paste the whole of `rehearsal_phase0_prices.sql` and press Run | A red error that starts "REHEARSAL DONE. NOTHING WAS SAVED. ALL CLEAR" with `findings=0, test_errors=0` | ☐ | ☐ |

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
| 7b.9a | Owner | Same list | Find a payout that was **Approved** (from step 7b.5), not Recorded | It has no **Reverse** button. This is how the screen was built (Master Specification S2). Tick Pass if there is no button | ☐ | ☐ |
| 7b.10 | Owner | **Cash drawer**, **Cashier limit** box | Type `12000` and press **Save limit** | "The limit was changed." The label now says ₦12,000.00. Put it back to `10000` afterwards | ☐ | ☐ |
| 7b.11 | Purchaser | Home, then **Buy & Stock**, then **Purchases** | Log a purchase: **Payment** Cash. Tick **Paid from the cash drawer**. Submit | Saved. On the Cash drawer screen (as owner) a new payout "Purchase of …, paid from the drawer" appears | ☐ | ☐ |
| 7b.12 | Owner | **Purchases**, **Recent purchases** | Reverse that purchase with a reason | The purchase is reversed AND the payout on the Cash drawer screen shows as Reversed with the same reason | ☐ | ☐ |
| 7b.13 | Purchaser | Home, then **Buy & Stock**, then **Suppliers**, **Pay a supplier** | Pick a supplier, amount `500`. Open **How was it paid?** and choose **Cash from the drawer**. Press **Record payment** | Saved. A payout "Payment to …, paid from the drawer" appears on the Cash drawer screen | ☐ | ☐ |
| 7b.14 | Purchaser | Same screen | Pay a supplier `100` and choose **Bank transfer** | Saved. No new payout appears. Open the supplier's page: the line says "Bank transfer" | ☐ | ☐ |
| 7b.14a | Purchaser | Same screen | Try to press **Record payment** with **How was it paid?** left on "Choose how it was paid" | The button stays greyed out | ☐ | ☐ |
| 7b.14b | Purchaser | Same screen | Choose **Other** and leave the note empty (or type `abc`) | A red message asks for a note of at least 5 characters, and the button stays greyed out. With the note `paid by POS card` it saves | ☐ | ☐ |
| 7b.14c | Purchaser | Same screen, with **no shift open** | Choose **Cash from the drawer** and press **Record payment** | A red message: "There is no open shift, so this cannot be paid from the cash drawer…". Nothing is saved (the supplier balance does not change). Choose **Bank transfer** instead and it saves | ☐ | ☐ |
| 7b.15 | Cashier | **Cash drawer** | **Check first:** if float plus cash sales is less than what you took out, the expected figure is below zero and cannot be typed as a count. Ring up cash sales on the Till first (Home, then **Sell**, then **Till**), or have the owner close the shift with **Close this shift as owner**. Then count the drawer: float, plus cash sales, minus everything taken out and approved (declined and reversed ones do not count). Type that in **Cash counted in drawer (₦)** and press **Close shift** | "Shift closed". The summary shows **Cash paid out of the drawer** and the shift is **Balanced** | ☐ | ☐ |
| 7b.16 | Owner | **Cash drawer**, **Closed shifts** | Look at the closed shift | The line shows "paid out ₦…" with the figures | ☐ | ☐ |
| 7b.17 | Cook or Purchaser | The address bar | Type the address of the Cash drawer screen (`/drawer`) after the web address | The page says "Cashiers and owners only." | ☐ | ☐ |

### Catering deposit method

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 7b.18 | Owner or cashier: Home, then **Sell**, then **Catering** | Start a booking. Type a **Deposit paid (₦)** of `500`. Do not choose how it was paid yet | A new box **How was the deposit paid?** appears. The booking cannot be saved: the message says to choose cash or transfer | ☐ | ☐ |
| 7b.19 | Same booking | Choose **Cash** and book it | Booked. With a shift open, the cash deposit is counted in that shift's expected cash | ☐ | ☐ |

### Catering calendar

| # | Go to | Do | You should see | Pass | Fail |
|---|---|---|---|---|---|
| 7b.20 | Owner or cashier: Home, then **Sell**, then **Catering** | Find a **confirmed** order that has a date. Press **Add to calendar** | Up to four buttons: **Share calendar file (any calendar)**, **Google Calendar**, **Outlook**, and (only if the customer's phone number is readable) **Send calendar links to customer on WhatsApp**. A line under them says how long the entry lasts and that it holds no prices | ☐ | ☐ |
| 7b.21 | Same | On a phone, press **Share calendar file (any calendar)** | The phone's share list opens (choose WhatsApp or Files). On a computer the file downloads instead and a green message says it was saved | ☐ | ☐ |
| 7b.22 | Same | Open the file you saved or received | Your calendar offers to add "{business}: catering order" on the right date at the event time (Nigeria time), for 2 hours, with the address as the place and an alert one day before. No price or balance is in it | ☐ | ☐ |
| 7b.23 | Same | Press **Google Calendar** | A Google Calendar page opens with the title, date, time, place and items filled in. Saving adds it | ☐ | ☐ |
| 7b.24 | Same | Press **Outlook** | Outlook on the web opens with the same details. If it fails for a work or school account, write that down: the calendar file is the reliable route | ☐ | ☐ |
| 7b.25 | Same | Press **Send calendar links to customer on WhatsApp** | WhatsApp opens a message to the customer with a Google link and an Outlook link, and no prices | ☐ | ☐ |
| 7b.26 | Same | Look at an order that is an **enquiry** or **cancelled**, and at one with no event time | The enquiry and the cancelled order show no **Add to calendar**. An order with no event time gives an all-day entry | ☐ | ☐ |

## Module D. Offline resilience, safe degraded mode (Phase 0)

Run on a real Android phone. Do UAT-OFF-01 to 07 first, then 08 to 15.

**Test data:** cashier account, owner account, a normal menu dish, a credit customer (name and phone), and one cash, one transfer and one split sale. UAT-OFF-14 also needs a second test business.

**Record for this run:** Tester ______________ Device ______________ Browser and version ______________ Android version ______________ Start time ________ End time ________

| ID | Test | Connection setup | Do | Expect | Actual | Pass | Fail | Blocked | Screenshot / recording ref (for any fail) |
|---|---|---|---|---|---|---|---|---|---|
| UAT-OFF-01 | Normal online cash sale | Online | Add two dishes, Cash, press Charge. Check Orders. | One order with a sale code; draft clears only after the save is confirmed. | | ☐ | ☐ | ☐ | |
| UAT-OFF-02 | Double-tap Charge | Online | Build a sale, tap Charge twice quickly. Check Orders. | One order only; the second tap returns the original sale. | | ☐ | ☐ | ☐ | |
| UAT-OFF-03 | Connection drops before submit | Airplane mode | Build a sale, turn on airplane mode, try Charge. Reconnect, check Orders. | Red offline warning; Charge disabled; draft kept; no sale created. | | ☐ | ☐ | ☐ | |
| UAT-OFF-04 | Connection drops during submit | Airplane mode straight after Charge | Press Charge, cut connection at once. Try another sale. | "Checking sale status…"; draft locked; no second sale possible. | | ☐ | ☐ | ☐ | |
| UAT-OFF-05 | Server saved, browser timed out | Airplane mode straight after Charge | Reconnect, press Check again. | Original sale found; no duplicate; draft clears only after confirmation. | | ☐ | ☐ | ☐ | |
| UAT-OFF-06 | Server did not save | Airplane mode before the request leaves | Reconnect, Check again, then Charge again. Check Orders. | Reported not saved; retry creates exactly one sale. | | ☐ | ☐ | ☐ | |
| UAT-OFF-07 | Refresh during unsaved draft | None | Build a split sale with several items, refresh. | Items, quantities, payment method and split amounts restore. | | ☐ | ☐ | ☐ | |
| UAT-OFF-08 | Credit draft refresh | None | Credit sale with name and phone, refresh. Then discard (and let one expire). | Name and phone restore; removed on discard or expiry. | | ☐ | ☐ | ☐ | |
| UAT-OFF-09 | Cash/transfer/split draft refresh | None | Build each, refresh. | No customer details kept on the device. | | ☐ | ☐ | ☐ | |
| UAT-OFF-10 | Browser restart during outage | Airplane mode | Build a sale offline, close browser fully, reopen Till. | Recoverable draft offered, clearly not a saved sale. | | ☐ | ☐ | ☐ | |
| UAT-OFF-11 | Paper fallback | Airplane mode | Print the paper form. | All fields print; it says it is not a saved NairaPlate sale. | | ☐ | ☐ | ☐ | |
| UAT-OFF-12 | Connection returns | Airplane mode off | Go offline, then reconnect; watch the bar and Charge. | Offline → checking → online; Charge back only after a successful server check. | | ☐ | ☐ | ☐ | |
| UAT-OFF-13 | Existing sale code reused | Controlled resend | Resend the same sale code for the same business. | Original order returned; no new sale. | | ☐ | ☐ | ☐ | |
| UAT-OFF-14 | Cross-business client sale code isolation | Second test business | From business B, Check again and submit with Demo Kitchen's code. | B cannot see Demo Kitchen's sale; B's submission becomes only B's order; Demo Kitchen's order unchanged. | | ☐ | ☐ | ☐ | |
| UAT-OFF-15 | Expired draft guard | Draft (cash and credit) last edited over 24 hours ago, set by a safe test method | Open the Till; read the card; look for Charge; press Ask owner to review; discard with reason and confirm; check stored drafts and Orders, payments, stock, drawer, Credit | Card says "Expired — not saved" with times, items, payment, unconfirmed total, customer-details flag and "no order, payment, stock movement or cash-drawer entry was created"; cannot be charged; review form prints and draft stays uncharged; discard removes it and any customer name/phone; nothing created in money or stock records | | ☐ | ☐ | ☐ | |

**Release gate.** Phase 0 is not released until all 15 tests have a recorded result and all of these hold:

1. No duplicate order is created in double-submit, retry and timeout-recovery paths.
2. No unsaved draft is shown as a saved sale.
3. Cashier instructions are understood during offline and uncertain-submission states.
4. No unnecessary customer data stays in non-credit drafts, or after a draft is discarded or expires.
5. Health check, regression tests and full rehearsal remain clean after the Phase 0 changes.
6. The deployed preview is tested on at least one real Android phone using airplane mode, not only desktop tools or unit tests.

**Owner sign-off (Module D):** I (name) ______________ ran Module D on (date) ____________. Passed ____ of 15. Failed ____. Blocked ____.

## Module E. Paper (late) entries (after release)

Do **not** run this module until the permission fix is applied, D1 to D4 and D6 are fixed, and the screens are released (see the box at the top). Run it as the Owner and as a Cashier (UAT Tester) in two browsers. Rejections and approvals cannot be undone. Use test dishes.

**Test data:** a dish that has never been edited (for example Jollof Rice), a dish whose menu row is a later version (for example Eba & Egusi), a past shift that is closed and the current open shift.

| ID | Sign in as | Go to | Do | You should see | Known defect | Pass | Fail | Blocked |
|---|---|---|---|---|---|---|---|---|
| UAT-LATE-01 | Cashier | Home, then **Sell**, then **Paper sales** | Look at the tabs and buttons | The tab **Enter paper sale** is open. There is no **Approve & post** and no **Reject** button anywhere | | ☐ | ☐ | ☐ |
| UAT-LATE-02 | Cashier | **Paper sales**, **Enter paper sale** | Type **Paper form reference** `PS-001`, **Actual sale time** two hours ago, **Why it was on paper** `network down`. Pick **Jollof Rice** quantity `2`, payment Cash. Press **Send to owner for approval** | The entry is sent. The screen says it is a request that is not yet a saved sale and does not change cash, stock or reports. The price shown for the dish is the price in force at that time | | ☐ | ☐ | ☐ |
| UAT-LATE-03 | Owner | **Orders**, **Cash drawer**, **Ingredients**, **Stock trail** | Look for the paper sale | Nothing: no new order, no change in expected cash, no stock movement | | ☐ | ☐ | ☐ |
| UAT-LATE-04 | Cashier | **Enter paper sale** | Enter a paper sale for **Eba & Egusi** with a sale time two hours ago | The dish shows its price at that time and the entry is sent | **D1.** Today the screen shows "no price then" and the database refuses | ☐ | ☐ | ☐ |
| UAT-LATE-05 | Cashier | **Enter paper sale** | Try a sale time 4 days ago, then a time tomorrow | Both are refused: older than 72 hours, and not in the future | | ☐ | ☐ | ☐ |
| UAT-LATE-06 | Cashier | **Enter paper sale** | Fill a valid entry (reference `PS-002`) and press **Send to owner for approval** twice quickly | Only one entry exists in the owner's **Waiting** tab | | ☐ | ☐ | ☐ |
| UAT-LATE-07 | Owner | **Paper sales**, **Waiting** | Open an entry with **Details**. Type `no` as the reject reason: **Reject** stays greyed out. Type `duplicate of a till sale` and press **Reject** | The entry moves to **Posted & rejected** as rejected, with your reason. Orders, cash and stock are unchanged | | ☐ | ☐ | ☐ |
| UAT-LATE-08 | Owner | **Paper sales**, **Waiting** | Approve a cash entry whose sale time is inside the **currently open** shift (press **Approve & post**) | A sale is posted. **Orders** shows it with a **Late entry** label, the paper reference, the real sale time, who entered it and who approved it. Stock is reduced for a made-to-order dish. Expected cash on the open shift includes the cash | | ☐ | ☐ | ☐ |
| UAT-LATE-09 | Cashier, then Owner | **Enter paper sale**, then **Waiting** | Enter a **Transfer** entry. As owner, approve it | It posts, and the order is shown as waiting for payment or paid, as decided. It does not fail | **D2.** Today the approval fails with a database error | ☐ | ☐ | ☐ |
| UAT-LATE-10 | Cashier, then Owner | Same | Enter a **Split** entry (cash part and transfer part). Approve it | It posts. Only the cash part counts in the shift's expected cash | | ☐ | ☐ | ☐ |
| UAT-LATE-11 | Cashier, then Owner | Same | Enter a paper sale whose time falls in an earlier shift that is **closed**. As owner, open it | It shows **needs shift review**. **Approve & post** stays greyed out until you choose one of the two answers about the cash | | ☐ | ☐ | ☐ |
| UAT-LATE-12 | Owner | Same, then **Cash drawer** | Choose "Yes, the cash was included in the count at close" and approve. Look at the **open** shift's expected cash and the closed shift | The sale posts. The open shift's expected cash does **not** include that cash. The closed shift's figures are unchanged | **D3.** Today the open shift counts the cash | ☐ | ☐ | ☐ |
| UAT-LATE-13 | Owner | Same, then **Cash drawer** | Do the same with a second entry and choose "No, record it as late cash against that closed shift" | The closed shift shows one adjustment for that cash amount. The cash is counted once only | **D3, D6.** Today it counts in the open shift too | ☐ | ☐ | ☐ |
| UAT-LATE-14 | Owner | **Orders** | On a posted paper sale press the usual refund or void | It works like any other sale. Write down whether a void is allowed: a void is normally only on the day of the sale, and for a paper sale it is not clear which day counts | | ☐ | ☐ | ☐ |
| UAT-LATE-15 | Cook or Purchaser | The address bar | Type `/late-entries` after the web address | No entries and no approve or reject buttons. Nothing can be sent | | ☐ | ☐ | ☐ |
| UAT-LATE-16 | Owner | **Oversight**, then **Audit trail** | Look for the lines for the entries above | "Late entry submitted", "Late entry rejected" and "Late entry posted" lines with the paper reference and amounts | | ☐ | ☐ | ☐ |

**Owner sign-off (Module E):** I (name) ______________ ran Module E on (date) ____________. Passed ____ of 16. Failed ____. Blocked ____. Defects D1 to D4 and D6 fixed and re-tested: yes / no.

## Module F. Dish price history (after release)

Do not run this module until the price-history screen is released. Owner only, except UAT-PRICE-08.

| ID | Go to | Do | You should see | Pass | Fail | Blocked |
|---|---|---|---|---|---|---|
| UAT-PRICE-01 | Home, then **Kitchen**, then **Recipes**. Press **Edit** on a saved dish. Scroll to **Price history** | Read the list | One row marked **In use** (set by "Starting price") with today's start time, and the explanation that a started price can't be changed | ☐ | ☐ | ☐ |
| UAT-PRICE-02 | Same | Under **Set new price (₦)** type today's price plus `50`. Keep **Start now**. Press **Use this price now** | The message "New price is now in use." The old row says **Ended**, the new row **In use** | ☐ | ☐ | ☐ |
| UAT-PRICE-03 | Home, then **Sell**, then **Till** | Add that dish and press Cash | The Till shows the new price and a cash sale at the new total saves. The earlier sale in **Orders** keeps the old price | ☐ | ☐ | ☐ |
| UAT-PRICE-04 | Back on the dish's **Price history** | Choose **Start on…**, pick tomorrow 09:00, type a price, press **Schedule price** | "New price scheduled for …". A row marked **Scheduled** with a **Cancel** button. The Till still charges today's price | ☐ | ☐ | ☐ |
| UAT-PRICE-05 | Same | Choose **Start on…** and pick a time in the past | A red message: "Pick a future date and time." | ☐ | ☐ | ☐ |
| UAT-PRICE-06 | Same | Press **Cancel** on the scheduled row. Look at the **In use** and **Ended** rows | "Scheduled price cancelled." The row is gone. The rows that have started have no Cancel button and no way to edit them | ☐ | ☐ | ☐ |
| UAT-PRICE-07 | **Oversight**, **Pricing review** | Publish a price on a dish, then open that dish's **Price history** | A new row appears, set by "Recipe or pricing change". Reversing the decision (Part 5) adds another | ☐ | ☐ | ☐ |
| UAT-PRICE-08 | Cook, then Cashier | Open **Recipes** and edit a dish | No **Price history** panel is shown to a cook or a cashier | ☐ | ☐ | ☐ |
| UAT-PRICE-09 | Owner | **Oversight**, **Audit trail** | "Dish price started", "Dish price scheduled" and "Dish price cancelled" lines with the dish, the price and the time (Lagos) | ☐ | ☐ | ☐ |

**Owner sign-off (Module F):** I (name) ______________ ran Module F on (date) ____________. Passed ____ of 9. Failed ____. Blocked ____.

## Part 8. Final tidy-up

| # | Do | Pass | Fail |
|---|---|---|---|
| 8.1 | If you opened a shift and did not close it, close it now | ☐ | ☐ |
| 8.2 | When the first-time user has finished, go to **Oversight**, then **Staff**, find UAT Tester and press **Deactivate** | ☐ | ☐ |

## What to send me

For every Fail: the step number, what you did, what you saw, and the exact words of any message. Also send the outputs of steps 0.1 and 0.2 (and 0.5 once it applies). I will check the database side before changing anything.

**Sign-off:** I (name) ______________ ran this script on (date) ____________. Steps passed ____ of ____. Steps failed ____.
