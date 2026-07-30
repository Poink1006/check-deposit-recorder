-- Check Deposit Recorder — require login (run in the project's SQL editor).
--
-- Switches access from "anyone with the key" (anon) to "signed-in users only"
-- (authenticated). After this, the embedded publishable key is useless without
-- the shared account login, so the app is safe to ship publicly.
--
-- Run this ONCE, and make sure the shared account exists (Authentication →
-- Users → Add user, with a password, "Auto Confirm User" checked) so people
-- can actually sign in.

alter table public.deposits      enable row level security;
alter table public.deposit_items enable row level security;

-- remove the old open (anon) policies
drop policy if exists "anon all deposits"      on public.deposits;
drop policy if exists "anon all deposit_items" on public.deposit_items;

-- (idempotent) recreate the authenticated policies
drop policy if exists "auth all deposits"      on public.deposits;
drop policy if exists "auth all deposit_items" on public.deposit_items;

create policy "auth all deposits"
  on public.deposits      for all to authenticated using (true) with check (true);
create policy "auth all deposit_items"
  on public.deposit_items for all to authenticated using (true) with check (true);
