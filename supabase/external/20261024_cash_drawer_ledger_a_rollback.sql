-- Rollback for part A. REFUSES (changes nothing) if any count adjustment or forced close exists, because that would lose real records.
-- Otherwise it removes the guard, the functions, the adjustments table, the one-open index and the new columns (the saved breakdown figures on
-- closed shifts are lost; the shifts themselves stay). Run part B's rollback first if part B was run. All or nothing.
do $rb$ begin
  if exists (select 1 from public.cash_drawer_adjustments) or exists (select 1 from public.cash_drawers where forced) then
    raise exception 'Adjustments or forced closes exist. Rolling back would lose them. Nothing was changed.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='cash_drawers' and cmd in ('INSERT','UPDATE')) < 2 then
    raise exception 'Part B is still in place. Run 20261024_cash_drawer_ledger_b_rollback.sql first. Nothing was changed.';
  end if;
  drop trigger if exists cash_drawers_protect on public.cash_drawers;
  drop function if exists public.cash_drawers_protect();
  drop function if exists public.open_cash_drawer(bigint);
  drop function if exists public.adjust_closed_drawer(uuid, bigint, text);
  drop table if exists public.cash_drawer_adjustments;
  drop index if exists public.cash_drawers_one_open;
  alter table public.cash_drawers drop constraint if exists cash_drawers_force_reason_rule;
  alter table public.cash_drawers
    drop column if exists close_reason, drop column if exists forced, drop column if exists closed_by_name, drop column if exists closed_by,
    drop column if exists debt_cash_kobo, drop column if exists catering_cash_kobo, drop column if exists cash_sales_kobo, drop column if exists opened_by_name;
end $rb$;
