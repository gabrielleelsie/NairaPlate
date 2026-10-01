drop trigger if exists stock_movements_alerts on public.stock_movements;
drop function if exists public.raise_stock_alerts();
drop policy if exists margin_flags_select_purchaser on public.margin_flags;
drop policy if exists margin_flags_update_purchaser on public.margin_flags;
