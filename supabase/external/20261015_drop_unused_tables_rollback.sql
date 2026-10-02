-- Recreates sales_orders empty, with the columns and defaults it had (row-level security on, no policies, as before).
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  total_kobo bigint not null,
  payment_method text not null,
  status text default 'completed',
  created_at timestamptz default now()
);
alter table public.sales_orders enable row level security;
