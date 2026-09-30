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
