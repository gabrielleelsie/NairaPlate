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
