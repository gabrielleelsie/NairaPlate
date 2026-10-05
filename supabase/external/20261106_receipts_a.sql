-- 20261106_receipts_a.sql — Receipt and photo evidence (private).
-- Run once in the NairaPlate SQL editor. Safe to re-run.
-- Login model (verified in earlier migrations): staff_users.id = auth.uid();
-- business_id and role come from auth.jwt() -> 'app_metadata'.
-- The app never writes the receipts table directly: only attach_receipt / void_receipt.

begin;

-- 1. Private bucket (10 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 2. Table
create table if not exists public.receipts (
  id              uuid        primary key default gen_random_uuid(),
  business_id     text        not null references public.businesses(id) on delete restrict,
  record_type     text        not null check (record_type in ('purchase','payout','supplier_payment','late_entry')),
  record_id       uuid        not null,
  storage_path    text        not null unique,
  file_size_bytes integer     not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  mime_type       text        not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  width_px        integer     check (width_px is null or width_px > 0),
  height_px       integer     check (height_px is null or height_px > 0),
  caption         text        check (caption is null or length(caption) <= 255),
  uploaded_by     uuid        not null references public.staff_users(id) on delete restrict,
  uploaded_by_name text,
  uploaded_at     timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid        references public.staff_users(id) on delete restrict,
  delete_reason   text,
  constraint receipts_void_rule check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null and length(btrim(delete_reason)) >= 5))
);
create index if not exists receipts_record_idx on public.receipts (business_id, record_type, record_id);
comment on table public.receipts is
  'Photo evidence. Many receipts per record are allowed; each photo is one row. Rows are never edited; a voided receipt (deleted_at not null) is ignored by screens and exports but kept for audit.';

-- 3. Lock down: no direct access for anyone except the service role
alter table public.receipts enable row level security;
revoke all on public.receipts from anon, authenticated;
grant all on public.receipts to service_role;

-- Only void columns may change, once.
create or replace function public.receipts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Receipts cannot be deleted. Mark them not valid instead.'; end if;
  if old.deleted_at is not null then raise exception 'This receipt was already marked not valid.'; end if;
  if (new.id, new.business_id, new.record_type, new.record_id, new.storage_path, new.file_size_bytes, new.mime_type,
      new.width_px, new.height_px, new.caption, new.uploaded_by, new.uploaded_by_name, new.uploaded_at)
     is distinct from
     (old.id, old.business_id, old.record_type, old.record_id, old.storage_path, old.file_size_bytes, old.mime_type,
      old.width_px, old.height_px, old.caption, old.uploaded_by, old.uploaded_by_name, old.uploaded_at) then
    raise exception 'Receipts cannot be edited.';
  end if;
  return new;
end $$;
drop trigger if exists receipts_guard_trg on public.receipts;
create trigger receipts_guard_trg before update or delete on public.receipts
for each row execute function public.receipts_guard();

-- 4. Which roles may touch which record type (one definition, used everywhere)
create or replace function public.receipt_role_allowed(p_role text, p_record_type text) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_role in ('owner','supa_admin') then p_record_type in ('purchase','payout','supplier_payment','late_entry')
    when p_role = 'purchaser' then p_record_type in ('purchase','supplier_payment')
    when p_role = 'cashier'   then p_record_type in ('payout','late_entry')
    else false end
$$;
revoke all on function public.receipt_role_allowed(text, text) from public, anon;
grant execute on function public.receipt_role_allowed(text, text) to authenticated, service_role;

-- 5. Attach a photo that was already uploaded to the private folder
create or replace function public.attach_receipt(
  p_record_type text, p_record_id uuid, p_storage_path text, p_file_size_bytes integer,
  p_mime_type text, p_width_px integer default null, p_height_px integer default null, p_caption text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text;
  v_ok   boolean := false;
  v_id   uuid;
begin
  if v_uid is null or v_biz is null or v_role is null then raise exception 'Please sign in again.'; end if;
  if not (select public.business_has_access(v_biz)) then raise exception 'Your plan has ended.'; end if;
  if not public.receipt_role_allowed(v_role, p_record_type) then raise exception 'You cannot add photos to this kind of record.'; end if;
  if p_storage_path !~ ('^' || v_biz || '/' || p_record_type || '/' || p_record_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'The photo is in the wrong place.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = p_storage_path) then
    raise exception 'The photo did not finish uploading. Try again.';
  end if;

  if p_record_type = 'late_entry' then
    select true into v_ok from public.late_entries
     where id = p_record_id and business_id = v_biz and (v_role in ('owner','supa_admin') or entered_by = v_uid);
  elsif p_record_type = 'payout' then
    select true into v_ok from public.cash_drawer_payouts
     where id = p_record_id and business_id = v_biz and (v_role in ('owner','supa_admin') or recorded_by = v_uid);
  elsif p_record_type = 'purchase' then
    select true into v_ok from public.purchases where id = p_record_id and business_id = v_biz;
  elsif p_record_type = 'supplier_payment' then
    select true into v_ok from public.supplier_transactions where id = p_record_id and business_id = v_biz;
  end if;
  if not coalesce(v_ok, false) then raise exception 'That record was not found in your business.'; end if;

  select display_name into v_name from public.staff_users where id = v_uid;
  insert into public.receipts (business_id, record_type, record_id, storage_path, file_size_bytes, mime_type,
                               width_px, height_px, caption, uploaded_by, uploaded_by_name)
  values (v_biz, p_record_type, p_record_id, p_storage_path, p_file_size_bytes, p_mime_type,
          p_width_px, p_height_px, nullif(btrim(p_caption), ''), v_uid, v_name)
  returning id into v_id;

  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, v_uid, v_role, 'receipt_attached', 'receipts', v_id,
          format('%s added a photo to %s %s', coalesce(v_name, 'Staff'), p_record_type, p_record_id));
  return v_id;
end $$;
revoke all on function public.attach_receipt(text, uuid, text, integer, text, integer, integer, text) from public, anon;
grant execute on function public.attach_receipt(text, uuid, text, integer, text, integer, integer, text) to authenticated;

-- 6. Mark a photo not valid (owner / Supa Admin only, reason >= 5 characters)
create or replace function public.void_receipt(p_receipt_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_biz  text := auth.jwt() -> 'app_metadata' ->> 'business_id';
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_name text;
begin
  if v_role not in ('owner','supa_admin') then raise exception 'Only the owner can mark a photo not valid.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason of at least 5 characters.'; end if;
  select display_name into v_name from public.staff_users where id = v_uid;
  update public.receipts set deleted_at = now(), deleted_by = v_uid, delete_reason = btrim(p_reason)
   where id = p_receipt_id and business_id = v_biz and deleted_at is null;
  if not found then raise exception 'Photo not found, or already marked not valid.'; end if;
  insert into public.audit_logs (business_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (v_biz, v_uid, v_role, 'receipt_voided', 'receipts', p_receipt_id,
          format('%s marked a photo not valid: %s', coalesce(v_name, 'Owner'), btrim(p_reason)));
end $$;
revoke all on function public.void_receipt(uuid, text) from public, anon;
grant execute on function public.void_receipt(uuid, text) to authenticated;

-- 7. List photos for one record (only what the caller's role may see)
create or replace function public.list_receipts(p_record_type text, p_record_id uuid)
returns table (id uuid, storage_path text, mime_type text, caption text, uploaded_by_name text,
               uploaded_at timestamptz, deleted_at timestamptz, delete_reason text)
language sql stable security definer set search_path = public as $$
  select r.id, r.storage_path, r.mime_type, r.caption, r.uploaded_by_name, r.uploaded_at, r.deleted_at, r.delete_reason
    from public.receipts r
   where r.business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')
     and r.record_type = p_record_type and r.record_id = p_record_id
     and public.receipt_role_allowed(auth.jwt() -> 'app_metadata' ->> 'role', p_record_type)
   order by r.uploaded_at
$$;
revoke all on function public.list_receipts(text, uuid) from public, anon;
grant execute on function public.list_receipts(text, uuid) to authenticated;

-- 8. Counts for exports (owner / Supa Admin only; voided photos not counted)
create or replace function public.receipt_counts(p_record_type text, p_record_ids uuid[])
returns table (record_id uuid, receipt_count integer)
language sql stable security definer set search_path = public as $$
  select r.record_id, count(*)::int
    from public.receipts r
   where r.business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')
     and (auth.jwt() -> 'app_metadata' ->> 'role') in ('owner','supa_admin')
     and r.record_type = p_record_type and r.record_id = any(p_record_ids) and r.deleted_at is null
   group by r.record_id
$$;
revoke all on function public.receipt_counts(text, uuid[]) from public, anon;
grant execute on function public.receipt_counts(text, uuid[]) to authenticated;

-- 9. Storage rules: own business folder, role allowed for that record-type folder; no update; delete owner only
drop policy if exists receipts_obj_insert on storage.objects;
drop policy if exists receipts_obj_select on storage.objects;
drop policy if exists receipts_obj_delete on storage.objects;
create policy receipts_obj_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'business_id')
  and public.receipt_role_allowed(auth.jwt() -> 'app_metadata' ->> 'role', (storage.foldername(name))[2])
);
create policy receipts_obj_select on storage.objects for select to authenticated using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'business_id')
  and public.receipt_role_allowed(auth.jwt() -> 'app_metadata' ->> 'role', (storage.foldername(name))[2])
);
create policy receipts_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'business_id')
  and (
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('owner','supa_admin')
    -- the uploader may remove their own file only while no receipt row points at it (failed attach clean-up)
    or (owner_id = auth.uid()::text and not exists (select 1 from public.receipts r where r.storage_path = name))
  )
);

commit;
