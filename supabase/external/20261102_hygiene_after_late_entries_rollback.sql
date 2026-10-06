-- Rollback: gives the new tables back the database's default grants. Not recommended; it re-opens what the health check flags.
grant all on public.late_entries, public.late_entry_items to anon, authenticated;
grant select on public.dish_price_periods to anon;
grant execute on function public.late_entries_protect() to public;
