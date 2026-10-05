<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Recipes are versioned: ingredient/yield edits create a new recipes row via save_recipe_version(); screens list only is_current rows; order_items/batches store recipe_version_id (DB trigger) and P&L costs by that version. Why: past sales must keep their original recipe cost.
- The NairaPlate brand mark is a hand-built inline SVG exposed only through `Logo`; the favicon is a static rendering of that same geometry. Why: every branded screen stays visually consistent and resolution-independent.
- Market-unit values and person-facing labels come only from `MARKET_UNIT_OPTIONS` in `staff-session.ts`; raw values remain unchanged in storage. Why: every screen offers the same Nigerian units without leaking underscores.
- Public sales videos and posters are served directly from `public/media` via `MEDIA_PATH = "/media"` in `src/routes/index.tsx`. Why: this works on the live Cloudflare site (confirmed 30 September 2026) and does not depend on the Lovable preview domain. Do not reintroduce a media proxy route.
- Contact form messages are saved to `contact_messages` before any email is tried; visitors see success once saved. Why: a failed email must never lose a lead.
- Public marketing navigation and brand styling are shared through `SiteHeader`, `SiteFooter`, `Logo`, and the `np-public` style scope; `/our-story` is a standalone content route. Why: public pages stay consistent without changing logged-in app typography or behavior.
- Changes to the live NairaPlate database are SQL files in `supabase/external/`, run by the owner in their own SQL editor and verified before any code release. Why: the live app uses an external database the agent cannot migrate.
- Business access (trial/paid plan) date rules live only in `src/lib/subscription.ts`; the database guard and `business_has_access()` enforce the same rule. Why: one Lagos-time definition of when access ends.
- Video and poster links in `src/routes/index.tsx` carry a `?v=N` tag. Change N whenever the files in `public/media` are replaced under the same names. Why: browsers and the CDN keep old copies of a file under an unchanged address.
- Till sales go through the `*_once` database functions with a device-made `client_sale_id`; a sale whose save is uncertain stays locked on the device until `find_sale_by_client_id` confirms it. Connection state lives in `src/lib/connectivity.ts`, drafts in `offline-store.ts`/`pos-draft.ts`. Why: a lost reply must never lead to a sale being charged twice, and NairaPlate does not claim offline selling.
- Dish selling prices are add-only rows in `dish_prices` (start now or scheduled); `dish_price_at(dish, time)` is the only historical price lookup, and `recipes.selling_price_kobo` is just the mirror of today's price, kept in step by a recipes trigger and `apply_due_dish_prices`. Why: late entries and audits must resolve the price in force at the actual sale time.
- Paper-fallback sales enter the ledger only via the late-entry RPCs (submit/approve_and_post/reject_late_entry) on `/late-entries`; screens never write late_entries or orders directly. Why: one approved, audited, historically-priced sale per paper record.
- Ingredient prices over time live only in append-only `ingredient_price_history` (tracks: current, A, B, C), written by database rules on purchases/reversals and by `set_ingredient_price`; the app reads it only via `ingredient_price_history_for`/`ingredient_price_at`, and an unknown past price is reported as unknown, never substituted. Why: historical costs must be honest and tamper-proof.
- Paper-sale plate cost is decided only by the database: `stamp_recipe_version` costs late-entry lines with `recipe_plate_cost_at()` at the actual sale time, accepts them only inside `approve_and_post_late_entry` (order-scoped `app.late_cost` flag + recorded owner cost decision), and any missing ingredient price makes the whole plate unknown (hold, or owner estimate at today's cost with stored evidence). Why: historical cost must be honest and never taken from the app.
- Accountant CSV exports are read-only, owner-gated, built in the browser from `src/lib/accountant-reports.ts`, and use versioned column lists in `REPORT_SCHEMAS` (change columns only with a version bump). Why: accountants need stable files and exports must never touch ledgers.
- Receipt photos live in the private `receipts` bucket at `<business>/<type>/<record>/<uuid>.jpg`; the app links them only via `attach_receipt`/`void_receipt`/`list_receipts`/`receipt_counts` (no direct table access), and role rules mirror `receipt_role_allowed` in `src/lib/receipt-capture.ts`. Why: evidence must be tenant-safe, immutable and never public.
- The margin diagnostic (`src/lib/margin-diagnostic.ts`) takes its headline numbers only from `calculateBusinessPnl()` and its `by_dish`/`by_channel` breakdown; drivers are estimates; unexplained remainder is shown. Why: it must reconcile with the P&L.
- Kitchen profiles are set only by platform admin; screens gate via `hasFeature()` in `src/lib/features.ts`; no profile column = Full Suite. Why: one switchboard, safe before SQL.
