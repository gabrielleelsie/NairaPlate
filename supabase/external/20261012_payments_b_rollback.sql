drop function if exists public.record_provider_payment(text, text, text, bigint, jsonb);
drop function if exists public.attach_payment_account(uuid, text, text, text, timestamptz);
drop function if exists public.create_transfer_order(text, text, jsonb);
