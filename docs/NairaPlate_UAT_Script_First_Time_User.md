# NairaPlate user test: for someone who has never used it

**Thank you for helping.** You are testing the app, not being tested. If something is confusing, that is the app's fault, not yours, and it is exactly what we want to find out. There are no wrong answers.

**How long:** about 30 minutes.
**What you will pretend to be:** a cashier at a small restaurant called Demo Kitchen. Nothing you do here is real. No real money moves.

---

## Your sign-in details (the person running the test fills these in)

| Item | Detail |
|---|---|
| Website | ______________________________ |
| Business code | `demo-kitchen` |
| Your name on the list | `UAT Tester` |
| Your PIN (4 to 8 digits) | ______________ |

**Please keep the PIN private.** If you enter the wrong PIN several times, the app locks the account. If that happens, stop and tell the person running the test. After the test, your access will be switched off.

---

## For the person running the test (read before you start)

- Sit next to her and watch. **Do not touch the screen and do not explain** unless she is stuck for 2 full minutes. Then give the smallest hint you can and write it down.
- Before she starts, make sure there is **no shift already open** in the Cash drawer (see the owner script, step 8.1). Otherwise she will not be able to open one.
- Record what you see on the **Observer sheet** at the end. The things we care about most: where she hesitates, where she taps the wrong thing, what words she does not understand, and how long each task takes.
- Ask her to say her thoughts out loud ("I am looking for…", "I expected…").

---

## Tasks

Do the tasks in order. Read each task out loud before you do it. Under each task, "You should see" tells you what to expect. Try the task first without peeking. If the screen does not match, say so out loud.

### Task 1. Sign in

1. Open the website on your phone or computer.
2. A screen asks for your **business code**. Type `demo-kitchen` and press **Continue**.
3. A screen says **Who's working?** Tap your name, **UAT Tester**.
4. Type your PIN and sign in.

**You should see:** the home screen with a group called **Sell** (and nothing about buying or the kitchen). **Did anything surprise you? ______________**

### Task 2. Open the till for the day

1. From the home screen, under **Sell**, tap **Cash drawer**.
2. You are starting the shift with ₦2,000 in the drawer. Type `2000` where it asks for the **Opening float (₦)**.
3. Press **Open shift**.

**You should see:** "Shift open since …" with a ₦2,000 float.

### Task 3. Sell a dish for cash

1. Go back (the **Home** link at the top), then tap **Till** under **Sell**.
2. Under **Item**, choose any dish. Leave the quantity at 1. Press **Add**.
3. Under **Payment**, choose **Cash**.
4. Press the big button that says **Charge ₦…**

**You should see:** a message that the sale was saved.

### Task 4. Sell to a customer who will pay later

1. On the **Till**, add a dish again.
2. Under **Payment**, choose **Customer credit (owe)**. Type the customer name `Mrs Ade` and phone number `08000000001`.
3. Press the button that now says **Put ₦… on credit**.

**You should see:** a message that it was put on credit.

### Task 5. Take a payment from that customer

1. Go to **Home**, then **Customer credit**.
2. Find **Mrs Ade** under **Still owing**.
3. Press **Record payment**. Pay a smaller amount than she owes, paid in cash.

**You should see:** what she still owes goes down by the amount you took.

### Task 6. Fix a mistake

You rang up the wrong dish for the cash sale in Task 3. Cancel it.

1. Go to **Home**, then **Orders**.
2. Find the cash sale from Task 3.
3. Press **Void / Refund**, choose **Void**, and type a reason (at least 5 letters), for example `wrong dish`.
4. Press the **Void ₦…** button.

**You should see:** the order now says **Voided**.

### Task 7. Give part of the money back

1. On the **Till**, sell one more dish for cash.
2. In **Orders**, press **Void / Refund** on it and choose **Part refund**.
3. Type an amount smaller than the total, a reason, and press the refund button.

**You should see:** the order says **Part refunded**. On the **Adjustments** tab you see your refund.

### Task 7b. Take cash out for a market run

During the day the cook needs ₦4,000 of tomatoes from the market and you give it from the drawer.

1. Go to **Home**, then **Cash drawer**.
2. Scroll down to **Cash taken out**.
3. Type `4000` for the **Amount (₦)**. Under **What for**, choose **Market run**. In **Note**, type what it was for, for example `tomatoes and pepper`.
4. Press **Take cash out**.

**You should see:** a message that it was recorded, and the entry in the list below. **Did you understand what the limit text above the form means? ______________**

### Task 8. Count the drawer and close the day

1. Go to **Cash drawer**.
2. Pretend you counted the cash in the drawer. Work it out: the float, plus the cash sales, minus the ₦4,000 you took out for the market run. Type that figure in **Cash counted in drawer (₦)**. (If you are not sure, type `3500` and read what the app tells you.)
3. Press **Close shift**.

**You should see:** "Shift closed", with a figure for the cash the app expected and any difference. If it shows a difference, that is fine. Read it out loud and tell us whether you understand it.

### Task 9. Try something you should not be able to do

1. On the home screen, look for anything about **buying ingredients** or **staff**. Do you see it? (You should not.)
2. Go to **Orders**. If you can see orders that someone else made, try to void one.

**You should see:** the app refuses with a message like "Only an owner can adjust another cashier's order". Read the message out loud. **Did you understand what it meant? ______________**

### Task 10. Sign out

Find how to sign out (the exit icon near the top of the home screen). Sign out.

**You should see:** you are back at the sign-in screen.

---

## Your opinions (answer after the tasks)

Rate each from 1 (very hard / bad) to 5 (very easy / good).

| Question | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| How easy was it to sign in? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How easy was it to find what you wanted from the home screen? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How easy was it to make a sale? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How easy was it to cancel a sale or give money back? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How easy was it to close the day? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How clear were the messages the app gave you? | ☐ | ☐ | ☐ | ☐ | ☐ |
| How confident would you feel using this on a busy day? | ☐ | ☐ | ☐ | ☐ | ☐ |

1. What was the most confusing moment? ____________________________________________
2. Which word or message did you not understand? ____________________________________________
3. Was anything missing that you expected to find? ____________________________________________
4. What did you like? ____________________________________________
5. Would you use this in a real kitchen? Why or why not? ____________________________________________

---

## Observer sheet (for the person running the test)

| Task | Did she finish it alone? (Yes / With a hint / No) | Time taken | Wrong taps or hesitations | Words she did not understand | Hint you gave |
|---|---|---|---|---|---|
| 1. Sign in | | | | | |
| 2. Open the till | | | | | |
| 3. Cash sale | | | | | |
| 4. Credit sale | | | | | |
| 5. Take a payment | | | | | |
| 6. Void a sale | | | | | |
| 7. Part refund | | | | | |
| 8. Close the day | | | | | |
| 9. Something not allowed | | | | | |
| 10. Sign out | | | | | |

Anything the app did that looked like a fault (exact words on screen, and what she had just done): ____________________________________________

**After the test:** the owner goes to **Oversight**, then **Staff**, finds `UAT Tester`, and presses **Deactivate**. Send the completed sheets to me.
