-- Undo 20261110_transfer_lost_a.sql. Refuses while any order is "transfer_lost" or any loss record exists (they are audit evidence).
begin;
do $undo$
declare
  d text;
  o1 constant text := $o1$Confirm the transfer, or ask for help with a transfer that never arrived.$o1$;
  n1 constant text := $n1$Confirm the transfer, or mark the transfer as lost if it never arrives.$n1$;
begin
  if exists (select 1 from public.paper_transfer_losses) or exists (select 1 from public.orders where status = 'transfer_lost') then
    raise exception 'Transfers have been marked as lost. They are audit records and are not removed. Nothing was changed.';
  end if;
  d := pg_get_functiondef('public.cancel_unpaid_order(uuid,text)'::regprocedure);
  if position(n1 in d) > 0 then execute replace(d, n1, o1); end if;
end $undo$;
drop function if exists public.mark_paper_transfer_lost(uuid, text);
drop table if exists public.paper_transfer_losses;
alter table public.orders drop constraint if exists orders_status_check_v2;
alter table public.orders add constraint orders_status_check_v2
  check (status in ('draft','paid','cancelled','refunded','partially_refunded','awaiting_payment'));
commit;
