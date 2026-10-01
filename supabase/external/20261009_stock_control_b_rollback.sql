-- Undo stock control part B. Corrections already applied to stock stay; the counts and their lines are removed.
drop function if exists public.decide_stock_count(uuid, boolean);
drop function if exists public.submit_stock_count(text, boolean, jsonb);
drop function if exists public.apply_stock_count(uuid);
drop table if exists public.stock_count_lines;
drop table if exists public.stock_counts;
