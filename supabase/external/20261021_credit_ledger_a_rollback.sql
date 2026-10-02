-- Removes the credit payment history, its functions and guards, all or nothing. The debts themselves keep their settled flags.
-- Refuses (and changes nothing) if any real entry exists beyond the carried-over ones, because that history would be lost.
do $$ begin
  if exists (select 1 from public.credit_payments where not carried_over) then
    raise exception 'Payments, write-offs or reversals exist. Rolling back would lose them. Nothing was changed.';
  end if;
  drop function if exists public.create_manual_credit(text, text, bigint, text);
  drop function if exists public.reverse_credit_entry(uuid, text);
  drop function if exists public.write_off_credit(uuid, bigint, text);
  drop function if exists public.record_credit_payment(uuid, bigint, text);
  drop trigger if exists customer_credits_protect on public.customer_credits;
  drop function if exists public.customer_credits_protect();
  drop table if exists public.credit_payments;
  drop function if exists public.credit_payments_recompute();
  drop function if exists public.credit_payments_check();
  alter table public.customer_credits drop column if exists note, drop column if exists written_off_kobo, drop column if exists paid_kobo;
end $$;
