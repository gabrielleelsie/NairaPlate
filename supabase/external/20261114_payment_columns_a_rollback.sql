-- Removes the three columns and their checks. Any plan type, setup fee or reason already recorded on a payment is lost.
-- Roll the code back first (the new code writes these columns).
alter table public.subscription_payments drop constraint if exists subscription_payments_operating_mode_check;
alter table public.subscription_payments drop constraint if exists subscription_payments_setup_fee_check;
alter table public.subscription_payments drop column if exists operating_mode;
alter table public.subscription_payments drop column if exists setup_fee_kobo;
alter table public.subscription_payments drop column if exists difference_reason;
