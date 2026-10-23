# Farm Tracker

A PWA to record farm expenses for Fatehpur, Bhakkarpur and Rehmanbad farms and see where the money
goes: per farm, per expense head, per month and per payer. Cash received (inflow) and the running
balance are kept as an optional cash book view.
Plain HTML, CSS and JavaScript modules (no build step), Firebase Authentication and Cloud Firestore,
hosted on GitHub Pages. Engineering rules for every change are in [CLAUDE.md](CLAUDE.md).

## Pages

- **Dashboard** (home, Admin and Staff): total expenses for a period (This Month, Last Month, This Year,
  All Dates, Custom), this month's expenses, highest head and farm, farm-wise and head-wise bars,
  farm comparison and monthly trend charts. Cash received and balance are in a closed "optional" section.
- **Add Entry** (Admin): Expense Date, Farm, Expense Head, Amount (PKR), Paid By, Description, optional slip.
- **Entries** (Admin): search, filters (farm, head, payer, type, dates), sort by date or amount, filtered
  totals, edit, delete with confirmation, CSV export, and an optional cash book (running balance).
- **Reports** (Admin and Staff): Farm-wise, Head-wise, Monthly, Expense Details, Paid By and Cash Book.
  Export CSV and Print / PDF (Admin) always use the filters on screen.
- **Heads** and **Users** (Admin).

## How the numbers are calculated

An entry whose head type is **Outflow** is an expense; **Inflow** is cash received. The Dashboard, every
expense report and every export use one function, `buildExpenseAnalysis` in `src/domain/reports.js`.
Each expense is counted once in every grouping, so farm, head, payer and month totals always add up to
the same total (unit tests check this). A report table is built once as a model and the same model is
drawn on screen and written to the CSV (`src/ui/report-table.js`), so the export matches the screen.
Reports group by head **id**, so renaming a head never splits or duplicates its totals.

## Paid By "BM" is shown as "Amjad Ali"

Entries store the Paid By **value** `BM` (also allowed by `firestore.rules`); the app shows the
**label** "Amjad Ali" everywhere, including exports (`CONFIG.paidBy` in `src/config.js`). No stored data
was changed, old entries and backups stay valid, and the rules did not need a new deploy.

Head names to update once are listed in `CONFIG.headRenames` (now: "Cash by BM" -> "Paid by Amjad Ali").
When such a head exists, the Heads page shows a **Rename** button for the Admin. It uses the normal
safe head edit: the head keeps its id, the new name is copied into its entries, amounts/dates/ids do not
change, the change is written to the audit log, and it can be undone with Edit. It is not offered when a
head with the new name already exists (that would create a duplicate). Make a backup first.

## How the code is organized

```
index.html, style.css      All screens and styles (phone layout, print layout for PDF)
firebase-config.js         Firebase project config (public identifier, not a secret)
firestore.rules            Security rules: the real protection (validated on the server)
service-worker.js          Offline app shell; bump CACHE_VERSION on every app change
manifest.json, icons/      PWA install
src/
  main.js                  Entry point: login -> role check -> live data -> draw open page
  config.js                Farms, Paid By values and labels, head renames, default heads, limits
  firebase.js              Firebase setup (+ emulator switch for tests)
  state.js                 Data in memory
  domain/                  Pure logic: validation, filters, periods and report calculations (unit-tested)
  services/                Every Firestore / Auth call (data.js, auth.js)
  lib/                     Helpers: formatting, safe HTML, CSV, errors, image compression
  ui/                      One module per page + shared components, charts, period filter,
                           report tables (screen + CSV), navigation, messages
tests/
  unit/                    Vitest tests for domain/ and lib/
  rules/                   Security-rules tests (Firestore emulator)
  e2e/                     Playwright tests: the real app against the emulators, desktop and phone
```

Rules of thumb: pages never call Firestore directly (use `services/data.js`); anything put into HTML
goes through `escapeHtml`; farm lists and limits in `firestore.rules` must match `src/config.js`
(a unit test checks this).

## Developer setup

Needs Node.js 20+ and Java 21 (for the Firebase emulators).

```
npm install
npx playwright install chromium
npm test                 # unit + rules + end-to-end (all must pass before a release)
npm run test:unit        # fast, no emulator
npm run serve            # app at http://127.0.0.1:5500/ (add ?emulator to use local test data)
```

On Windows PowerShell use `npm.cmd` / `npx.cmd` if scripts are blocked.

## Deploying

- **App:** push to `main`; GitHub Pages publishes it. Bump `CACHE_VERSION` in `service-worker.js` first.
- **Security rules:** `npx firebase login` once, then `npm run deploy:rules`.

## One-time Firebase setup (already done for this project)

1. Authentication > Sign-in method > enable Email/Password; Settings > User actions > untick "Enable create (sign-up)".
2. Create Firestore (production mode) and deploy the rules (above).
3. First Admin: Authentication > Users > Add user, copy the **User UID**. In Firestore create
   `users/<UID>` with `name`, `email`, `role: "admin"`, `status: "active"` (no other fields).
4. Log in as Admin; the 12 default heads are created automatically.
5. Authentication > Settings > Authorized domains: add `<username>.github.io`.
6. Recommended: Google Cloud Console > APIs & Services > Credentials > restrict the browser API key
   to HTTP referrers `https://<username>.github.io/*` (and `http://127.0.0.1/*` for local work).

## Adding users

1. Firebase Console > Authentication > Users > **Add user** (email + temporary password). Copy the **User UID**.
2. In the app: **Users** > Add User > Name, Email, the UID, role.
3. Send the user the link and temporary password; they use **Change password** after logging in.

The UID is needed because each `users` record must use the login's UID as its ID, and a browser app
cannot look up a UID from an email on the free plan.

## Attachments (slip / bill)

Firebase Storage needs the paid plan, so files are stored in Firestore (`attachments`, same id as the
entry). Photos are compressed in the browser; PDFs must be under about 650 KB.

## Install on the phone

- **Android (Chrome):** open the link > **Install App** in the header.
- **iPhone (Safari):** Share > **Add to Home Screen**.
