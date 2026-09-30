# 7-day trial, paid plans and automatic lockout

## How the database change reaches your live database

The live app uses your own database (ckklehqascyglqnqtwpn), not Lovable Cloud. My database tool only reaches Lovable Cloud, so I cannot apply this change myself. You apply it the same way you created the contact messages table.

The rollout order is the same every time:

1. **Step 1: read-only check (you run it and paste me the result).** I give you one query that lists every access rule on the live database: `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public'`. I will name every changed rule from that output. The copy in this project is older and does not show newer tables such as audit_logs, recipe versions and suppliers.
2. **Step 2: I write the migration file** to `supabase/external/2026XXXX_subscriptions.sql`. It lives in its own folder so Lovable Cloud never runs it. I paste the full SQL in chat.
3. **Step 3: you run it** in the SQL editor of the ckklehqascyglqnqtwpn project. It runs as one transaction, so it either fully applies or changes nothing. Then you run the check query I give you and paste me the result. I also check it myself from the server.
4. **Step 4: only after that, the code goes live** through the Release to main action and the Cloudflare deploy.

**Why the database goes first:** the migration is designed to work safely with today's code.
- The backfill gives every approved business an active 7-day trial right away, so the new access check blocks nobody.
- Today's code changes business status only through the server, which the new protection allows.

The reverse order would break things: new code reading `access_ends_at` would fail if the database did not have that column yet.

**If you need to undo it:** a rollback script ships with the migration. It removes the protection, the helper, the new table and the new columns, and puts the access rules back. It only runs if you choose to run it.

## Database changes (one migration, one transaction)

1. **businesses:** add `access_ends_at timestamptz`, `plan text` limited to trial, monthly, quarterly or yearly, and `trial_started_at timestamptz`.
2. **New table subscription_payments,** exactly as you specified:
   - The access check on the table is on, with no rules for signed-in users. Only the server can read or write it.
   - Only the server role gets permissions on it.
   - Index on (business_id, created_at desc).
3. **Helper `public.business_has_access(bid text)`:**
   - STABLE, SECURITY DEFINER, search_path set to public.
   - Returns true only when status is 'approved' and access_ends_at > now().
   - Signed-in users are allowed to call it.
4. **Access rules:** every rule for signed-in users on every public table that has a `business_id` column gets `AND public.business_has_access(business_id)`.
   - This applies to the rule's read part and its write part.
   - One block of code loops over the live rules, so no table is missed. It logs each rule it changes, and that list goes in my report.
   - Expected tables: ingredients, unit_conversions, recipes (all versions), recipe_items, purchases, orders, order_items, batches, wastage_logs, customer_credits, catering_deposits, cash_drawers, channel_payouts, margin_flags, price_decisions, staff_users, audit_logs, suppliers and supplier payments, plus any others Step 1 shows.
   - **Excluded:** `businesses_select` stays readable so a locked owner can see the locked screen. The other businesses rules also get the check. contact_messages has no business_id and is untouched.
5. **Protection on businesses:** a check that runs before every update.
   - It raises "Billing and status fields can only be changed by NairaPlate" if status, access_ends_at, plan, trial_started_at, rejection_reason, reviewed_at or reviewed_by changes and the caller is not the server role.
   - Name and target margin still save as today.
6. **Backfill:** today's approved businesses get plan 'trial', trial_started_at = now(), and access_ends_at = 23:59:59 Lagos time on day 7 (go-live day counts as day 1). All other businesses keep NULL.
7. **Protect staff PINs (same migration):**
   - `revoke select, insert, update, delete on public.staff_users from authenticated, anon;`
   - `grant select (id, business_id, role, display_name, phone, email, is_active, created_at) on public.staff_users to authenticated;`
   - pin_hash, pin_salt, failed_attempts and locked_until are not granted to authenticated or anon. The server role keeps full access.
   - The staff_users row rules stay; staff_users_select still gets the access check. The insert, update and delete rules stay but no longer apply.
   - Browser code check (done): only `select("id,display_name")` in orders.tsx, audit.tsx and PricingReview.tsx. No `select("*")` or embedded staff selects anywhere in src, so no code change is needed.
   - Rollback adds: `grant select, insert, update, delete on public.staff_users to authenticated;`
   - Extra checks: as a signed-in owner, `select pin_hash` fails with a permission error while `select id, display_name` works; PIN login, create staff, reset PIN and change role still work; orders, audit and pricing review still show staff names.

## Server changes

- **src/lib/subscription.ts (new, shared):** pure date rules in Lagos time.
  - `trialEnd(approvedAt)` and `termFor(currentEnd, now, plan)`.
  - Month rule, written in a code comment: start day S, end = (S + N calendar months) − 1 day, at 23:59:59 WAT. Month-end starts cap at the last day of the month the way Postgres does.
  - Also `accessState(business)`, which returns active, expired, pending, suspended or rejected with days left, plus label helpers.
- **src/lib/subscription.test.ts (new):** tests for approval on a normal day, approval at 23:30 WAT, early renewal stacking, monthly from 31 January, and yearly across a leap year.
- **src/routes/api/public/platform-admin.ts:**
  - Approving a pending business starts the trial.
  - Reactivating a suspended business keeps the current end date. If that date has passed, the response adds `still_expired: true` with a message for the admin.
  - New `record_payment` action (admin tier), with checks on every field. It works out the term, saves the payment row, and updates the plan and end date. A suspended business stays suspended.
  - It writes an audit entry (new action `subscription_payment_recorded`) and emails the owner, logging `email_undelivered` if the email fails. It returns the new end date.
  - `list_businesses` and `business_detail` also return plan, trial and end dates, and has_access. Business detail also returns payments, newest first, with the recording admin's name.
  - `platform_health` adds counts for on trial, active paid and expired.
- **src/lib/email.server.ts:** new `sendPaymentConfirmation` helper that follows the existing pattern.
- **src/lib/audit.server.ts:** add `subscription_payment_recorded` to the allowed actions.
- **src/routes/api/public/staff-pin-login.ts:**
  - An approved business with no end date, or an end date in the past, is expired.
  - Owner and supa admin can sign in, and the session carries `access_locked: true` in the server-set account data.
  - Other roles get the existing neutral message.
- **src/routes/api/public/cash-drawer-close.ts and staff-admin.ts:** return 403 "Your NairaPlate plan has ended" when the business has no access.
- **business-signup.ts and contact.ts** do not read business data for staff, so they are unchanged.

## App changes

- **src/components/AccessGate.tsx (new):**
  - Wraps the logged-in pages and checks access on page load, when the window regains focus, and every 60 seconds.
  - When access has ended, owners and supa admins see the locked screen. Everyone else is signed out and sees the neutral message.
  - It also shows the ending-soon banner to owners and supa admins when 3 days or fewer are left.
- **src/components/LockedScreen.tsx (new):** your exact wording, the plan list, the three steps, and "Message us on WhatsApp" and "Sign out" buttons, in the public brand colours and Figtree.
- **Where AccessGate is mounted:**
  - The logged-in pages are separate top-level screens, so I will mount it once in `src/routes/__root.tsx`.
  - It does nothing on the public pages (home, our story, contact, signup, app sign-in, presentation) and on the platform admin screen.
  - This avoids editing each app page. Apart from that mount, the root file is unchanged.
- **src/routes/approvals.tsx:**
  - Status badges on each business, with expired rows highlighted.
  - Filters for Expired and Ending within 3 days.
  - A Record payment form that previews the new end date before saving and confirms it after.
  - A Payments history list in business detail.
  - A label for the new audit action.
- **src/routes/audit.tsx:** label for the new audit action only.
- **src/lib/staff-session.ts:** read `access_locked` from the session. This is a read-only addition.

## Not changing

Marketing pages, logo, images, videos, MEDIA_PATH, AGENTS.md rules, recipe versioning, costing, POS and reports, and the existing reject, suspend and emergency reset behaviour.

## Checks I will report

- All seven checks from your brief, run on the live database with a throwaway test business that I delete afterwards.
- The list of changed files and the full migration SQL.
- AGENTS.md gets one new line about the external migration workflow. That is a new rule; no existing rule changes.
