-- Grant the app's publishable/anon key full access to the four tables.
-- Run this in the Supabase SQL editor if the app connects but shows no data
-- (symptom: RLS error 42501, or empty categories/transactions).
--
-- This is a single-user app protected by an unguessable project URL, the
-- publishable key, and the app's passcode — so a permissive policy is fine.
-- Safe to run more than once.

alter table categories   enable row level security;
alter table transactions enable row level security;
alter table budgets      enable row level security;
alter table settings     enable row level security;

drop policy if exists "app full access" on categories;
drop policy if exists "app full access" on transactions;
drop policy if exists "app full access" on budgets;
drop policy if exists "app full access" on settings;

create policy "app full access" on categories   for all to anon, authenticated using (true) with check (true);
create policy "app full access" on transactions for all to anon, authenticated using (true) with check (true);
create policy "app full access" on budgets      for all to anon, authenticated using (true) with check (true);
create policy "app full access" on settings     for all to anon, authenticated using (true) with check (true);
