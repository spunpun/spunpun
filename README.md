# Budget App

A single-user budget tracker. Type one sentence (`5 aud coffee today`), it fills a form, you confirm, it's logged. Dashboard shows this month's spend vs budget per category. Built as a zero-build Progressive Web App — no Node, no toolchain. Works offline on phone + laptop; optional Supabase sync keeps devices in step.

Built from `Budget_2026_2027.xlsx` — all 155 historical transactions, 12 categories, budgets, and FX rates are pre-loaded.

## Files

| File | What it is |
|---|---|
| `index.html` | App shell |
| `app.js` | All screens, routing, CRUD, passcode lock |
| `parser.js` | Rule-based sentence parser (amount / currency / date / category / notes) |
| `store.js` | Data layer — localStorage backend (Supabase adapter swaps in here) |
| `seed.data.json` | Seed data: categories + keywords, budgets, FX rates, 155 transactions |
| `styles.css` | Styling (light + dark, mobile-first) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline |
| `parser.test.js` | Parser tests (run with JavaScriptCore, no Node needed) |
| `supabase/schema.sql` | Postgres schema + seed for cross-device sync |
| `supabase/migrate_transactions.sql` | The 155 transactions as SQL insert |

## Run it locally

It's static files. Serve the folder over HTTP (needed so the app can `fetch` the seed file):

```bash
cd "/Users/spun/budget app" && python3 -m http.server 8777
```

Then open <http://127.0.0.1:8777/index.html>.

## Run the parser tests (no Node required)

```bash
cd "/Users/spun/budget app" && /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc parser.test.js
```

## Deploy to Vercel (free, auto-syncs phone + laptop as a website)

1. Create a GitHub repo and push this folder (`git init && git add . && git commit && git push`).
2. On [vercel.com](https://vercel.com): New Project → import the repo → Framework preset **Other** → Deploy. No build command needed (static).
3. Open the Vercel URL on your phone → Share → **Add to Home Screen**. It installs full-screen like an app.

Every `git push` auto-redeploys.

> Updating an installed PWA: the service worker caches the app for offline use, so after you change the code, bump the `CACHE` value in `sw.js` (e.g. `budget-v1` → `budget-v2`) so phones pick up the new version on next open.

> Note: with the localStorage backend, each device keeps its **own** copy of the data. To truly sync phone ↔ laptop, add Supabase (below).

## Supabase sync (built and working)

The `supabase.js` adapter mirrors the `store.js` interface. The app **auto-connects** to the built-in project (`DEFAULT_SUPABASE_URL` / `DEFAULT_SUPABASE_KEY` in `app.js`), so every device syncs with zero setup; it falls back to local data if the network is down, and Settings → Cross-device sync → **Manage** lets a device override the URL/key or **Disconnect** to stay local.

> **Security note:** the built-in publishable key ships in the public app bundle (and this repo). Anyone who knows the app's web URL can therefore read/write the data — protection is the obscure URL + the passcode. Fine for a personal budget; for real access control, remove the defaults (back to per-device keys) or move to Supabase Auth.

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL Editor → run `supabase/schema.sql` (creates tables, seeds categories/budgets/FX, and adds the access policy).
3. SQL Editor → run `supabase/migrate_transactions.sql` (imports the 155 transactions).
4. Project Settings → API → copy the **Project URL** and the **publishable / `anon` key** (the browser-safe one, e.g. `sb_publishable_…` — **not** the `service_role` secret).
5. In the app: **Settings → Cross-device sync** → paste both → **Connect**. It verifies the connection, then reloads into synced mode ("● Synced via Supabase").

**Row-Level Security:** Supabase enables RLS by default, which silently blocks the publishable key from reading or writing (the app connects but shows no data, error `42501`). `schema.sql` now adds a permissive `app full access` policy so the key works. If you set the tables up before that, run `supabase/policies.sql` once to add it.

**Notes**
- The URL can be the base (`https://xxxx.supabase.co`) or the REST form (`…/rest/v1/`) — the adapter normalizes it.
- The key is stored per-device (in `localStorage`, never synced), so paste it in Settings on each device (phone + laptop). Don't hard-code it into a public repo — with the permissive policy, anyone with the URL + key can read/write the data.
- Passcode is also per-device. FX rates and last-used payment live in the synced `settings` table.

## Features

- **Quick entry** — on the Home page, type or paste into the box and hit **Next**. It parses and hands off to the **Confirm** tab, where you review the filled fields and hit Confirm. Manual entry: the **Add** tab opens a blank row.
- **Bulk add** — separate several expenses with **“and”**, a **comma**, or **new lines** (e.g. `12 lunch and 6 coffee and 30 didi`, or paste 5 lines Claude gave you). Each becomes its own editable card on the Confirm tab; **Confirm all** saves them in one go. Remove any row with ✕, or **＋ Add another** for an extra. (A separator only splits when the next part has its own amount, so `5 coffee and cake` stays one expense.)
- **Parser** — amount + currency (defaults AUD), dates (`today`/`yesterday`/weekdays/`aug 20`/`20/8`), category via editable keyword dictionary, notes = leftover words. Unmatched category → `Other`, flagged on the card.
- **Dashboard** — month selector; **Spent** and **Left** are color-coded by how much of the budget is used: green (comfortable, ≤75%), blue (getting close, 75–100%), red (over). Per-category progress bars carry their % (amber near limit, red over).
- **History** — filter by month + category, search notes, tap a row to edit/delete.
- **Budgets** — per category, per month, no rollover.
- **Categories** — full add/edit/delete; deleting reassigns its transactions to `Other`.
- **Multi-currency** — original currency stored, converted to AUD at save time using manual FX rates (Settings).
- **Passcode** — optional 4-digit lock (set in Settings).
- **PWA** — installable, offline-first.
- **Export** — JSON backup from Settings.

## Notes / v1 scope

Out of scope per the PRD: income tracking, live FX, receipt OCR, multi-user, push/alerts, trend charts. FX rates and passcode are manual. The `settings.passcode` is stored client-side — it gates the UI, not the database; use Supabase Auth if you need real access control.
