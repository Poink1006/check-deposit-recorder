-- Check Deposit Recorder — Supabase schema (run in the NEW project's SQL editor)
--
-- Mirrors the local SQLite tables, but with:
--   * UUID primary keys (so records created on different computers never collide)
--   * updated_at / deleted_at for last-write-wins sync and soft deletes
--
-- RLS is enabled. Because this app has NO login, the anon (publishable) key is
-- granted full access. Anyone holding that key can read/write, so keep the key
-- to your office machines. Tightening this later = add auth + narrow policies.

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ── deposits ────────────────────────────────────────────────────────────────
create table if not exists public.deposits (
  id             uuid primary key default gen_random_uuid(),
  deposit_date   date not null,
  bank           text not null default 'RCBC',
  account_name   text,
  account_number text,
  reference_no   text,
  notes          text,
  cash_total     numeric(14,2) not null default 0,
  check_total    numeric(14,2) not null default 0,
  grand_total    numeric(14,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ── deposit_items ───────────────────────────────────────────────────────────
create table if not exists public.deposit_items (
  id          uuid primary key default gen_random_uuid(),
  deposit_id  uuid not null references public.deposits(id) on delete cascade,
  section     text not null check (section in ('CASH','CHECK')),
  line_no     int  not null check (line_no between 1 and 24),
  amount      numeric(14,2) not null,
  check_no    text,
  drawee_bank text,
  check_date  date,
  remarks     text
);

create index if not exists idx_items_deposit    on public.deposit_items(deposit_id);
create index if not exists idx_deposits_updated on public.deposits(updated_at);

-- ── Row-Level Security (no login → anon full access) ─────────────────────────
alter table public.deposits      enable row level security;
alter table public.deposit_items enable row level security;

drop policy if exists "anon all deposits"      on public.deposits;
drop policy if exists "anon all deposit_items" on public.deposit_items;

create policy "anon all deposits"
  on public.deposits      for all to anon using (true) with check (true);
create policy "anon all deposit_items"
  on public.deposit_items for all to anon using (true) with check (true);
