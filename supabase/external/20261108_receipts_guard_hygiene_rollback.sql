-- Undo 20261108_receipts_guard_hygiene.sql (puts back the database default; not recommended).
grant execute on function public.receipts_guard() to public, anon, authenticated;
