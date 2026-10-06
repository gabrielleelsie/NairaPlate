-- Rollback for 20261106_receipts_a.sql. DESTRUCTIVE: removes all receipt rows.
-- Photo files stay in storage; empty the bucket separately only if you are sure.
begin;
drop policy if exists receipts_obj_insert on storage.objects;
drop policy if exists receipts_obj_select on storage.objects;
drop policy if exists receipts_obj_delete on storage.objects;
drop function if exists public.receipt_counts(text, uuid[]);
drop function if exists public.list_receipts(text, uuid);
drop function if exists public.void_receipt(uuid, text);
drop function if exists public.attach_receipt(text, uuid, text, integer, text, integer, integer, text);
drop table if exists public.receipts cascade;
drop function if exists public.receipts_guard();
drop function if exists public.receipt_role_allowed(text, text);
commit;
