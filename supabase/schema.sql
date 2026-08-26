-- Budget App — Supabase schema. Run this in the Supabase SQL editor.
-- Then run migrate_transactions.sql to import the 155 historical rows.

create extension if not exists "pgcrypto";

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  keywords text[] not null default '{}'
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category_id uuid references categories(id) on delete set null,
  amount numeric not null,
  currency text not null default 'AUD',
  amount_aud numeric not null,
  notes text default '',
  payment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_txn_date on transactions(date);
create index if not exists idx_txn_cat on transactions(category_id);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,
  month text not null,               -- 'YYYY-MM'
  amount_aud numeric not null,
  unique (category_id, month)
);

create table if not exists settings (
  key text primary key,
  value jsonb
);

-- ---- Seed categories + parser keywords (matches the app's seed.data.json) ----
insert into categories (name, keywords) values
  ('Rent', array['rent','real estate','sydney side','landlord','lease']),
  ('Groceries', array['woolworths','woolies','aldi','coles','costco','foodworks','iga','groceries','grocery','chargrill','too good to go','supermarket','market']),
  ('Dining', array['coffee','matcha','lunch','breakfast','brunch','dinner','kebab','rara','breadfern','cafe','restaurant','thai food','homestead','food','snack','bakery']),
  ('Transport', array['didi','uber','taxi','flight','opal','train','bus','max cap','transport','fuel','petrol','toll','grab']),
  ('Utilities', array['laundromat','amaysim','nbn','internet','electricity','water bill','gas bill','phone bill','utility','utilities']),
  ('Workout', array['climbing','bouldering','gym','playground','yoga','pilates','workout','fitness','one playground']),
  ('Social/networking', array['beer','movies','theater','theatre','catch up','drinks','rooftop','bar','networking','social','party','concert']),
  ('Subscriptions', array['app store','amazon prime','netflix','spotify','subscription','membership','icloud','youtube premium']),
  ('Travel', array['camping','overland','national park','hotel','airbnb','travel','trip','holiday','hostel']),
  ('Health', array['chemist','chemist warehouse','meds','medicine','protein','acupuncture','pharmacy','doctor','dentist','clinic','supplement']),
  ('Shopping', array['amazon','temu','daiso','bigw','big w','kmart','ikea','target','officeworks','projector','lskd','gymshark','gym shark','uniqlo','cotton on','muji','shoe rack','clothes','shopping','shopee','lazada','asos','the iconic']),
  ('Other', array[]::text[])
on conflict (name) do nothing;

-- ---- Seed budgets (from the sheet; Jun–Aug 2026) ----
insert into budgets (category_id, month, amount_aud)
select c.id, m.month, m.amt from (values
  ('Rent','2026-06',2800.0),
  ('Rent','2026-07',2800.0),
  ('Rent','2026-08',2800.0),
  ('Groceries','2026-06',550.0),
  ('Groceries','2026-07',550.0),
  ('Groceries','2026-08',550.0),
  ('Dining','2026-06',300.0),
  ('Dining','2026-07',300.0),
  ('Dining','2026-08',300.0),
  ('Transport','2026-06',350.0),
  ('Transport','2026-07',350.0),
  ('Transport','2026-08',350.0),
  ('Utilities','2026-06',250.0),
  ('Utilities','2026-07',250.0),
  ('Utilities','2026-08',250.0),
  ('Workout','2026-06',160.0),
  ('Workout','2026-07',160.0),
  ('Workout','2026-08',160.0),
  ('Social/networking','2026-06',200.0),
  ('Social/networking','2026-07',200.0),
  ('Social/networking','2026-08',200.0),
  ('Subscriptions','2026-06',50.0),
  ('Subscriptions','2026-07',50.0),
  ('Subscriptions','2026-08',50.0),
  ('Travel','2026-06',200.0),
  ('Travel','2026-07',200.0),
  ('Travel','2026-08',200.0),
  ('Health','2026-06',200.0),
  ('Health','2026-07',200.0),
  ('Health','2026-08',200.0),
  ('Shopping','2026-06',150.0),
  ('Shopping','2026-07',150.0),
  ('Shopping','2026-08',150.0),
  ('Other','2026-06',440.0),
  ('Other','2026-07',440.0),
  ('Other','2026-08',440.0)
) as m(cat, month, amt)
join categories c on c.name = m.cat
on conflict (category_id, month) do nothing;

-- ---- Seed settings (FX rates + last payment) ----
insert into settings (key, value) values
  ('fx_thb_aud', '0.04256241'::jsonb),
  ('fx_usd_aud', '1.39301'::jsonb),
  ('last_payment', '"Card"'::jsonb)
on conflict (key) do nothing;

-- Single-user app protected by an unguessable project URL + publishable key + the
-- app's passcode. Keep RLS on (Supabase best practice) and add a permissive policy
-- so the publishable/anon key can read and write. For stronger protection, replace
-- these with Supabase Auth policies.
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
