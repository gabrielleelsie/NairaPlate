-- Rollback for 20261030_sale_once_a.sql. Release the previous Till code FIRST, or the Till cannot save sales.
-- Refuses to run once any order carries a sale code, so no saved reference is ever lost.
begin;
do $$ begin
  if exists (select 1 from public.orders where client_sale_id is not null) then
    raise exception 'Not rolled back: orders already carry sale codes. Ask before removing them.';
  end if;
end $$;
drop function if exists public.find_sale_by_client_id(uuid);
drop function if exists public.create_transfer_order_once(uuid, text, text, jsonb);
drop function if exists public.create_credit_order_once(uuid, text, text, text, text, jsonb);
drop function if exists public.create_cash_order_once(uuid, text, text, text, bigint, bigint, jsonb);
drop function if exists public.sale_once_stamp(text, uuid, uuid);
drop function if exists public.sale_once_existing(text, uuid);
drop index if exists public.orders_business_client_sale_uniq;
alter table public.orders drop column if exists client_sale_id;
commit;
