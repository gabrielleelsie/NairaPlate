drop trigger if exists orders_payment_guard on public.orders;
drop function if exists public.orders_payment_guard();
drop function if exists public.read_payment_connection(text);
drop function if exists public.save_payment_connection(text, text, text, text, text, text, text);
drop function if exists public.cancel_unpaid_order(uuid, text);
drop function if exists public.set_payment_mode(text);
drop function if exists public.payment_mode_of(text);
-- Only safe when no order is waiting for the bank:
update public.orders set status = 'cancelled' where status = 'awaiting_payment';
alter table public.orders drop constraint if exists orders_status_check_v2;
alter table public.orders add constraint orders_status_check check (status in ('draft','paid','cancelled','refunded','partially_refunded'));
drop table if exists public.payment_events;
drop table if exists public.payment_requests;
drop table if exists public.business_payment_settings;
