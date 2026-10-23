# Farm Tracker

A PWA to record daily inflow and outflow for Fatehpur, Bhakkarpur and Rehmanbad farms.
Plain HTML, CSS and JavaScript modules (no build step), Firebase Authentication and Cloud Firestore,
hosted on GitHub Pages. Engineering rules for every change are in [CLAUDE.md](CLAUDE.md).

## How the code is organized

```
index.html, style.css      All screens and styles (phone layout, print layout for PDF)
firebase-config.js         Firebase project config (public identifier, not a secret)
firestore.rules            Security rules: the real protection (validated on the server)
service-worker.js          Offline app shell; bump CACHE_VERSION on every app change
manifest.json, icons/      PWA install
src/
  main.js                  Entry point: login -> role check -> live data -> draw open page
  config.js                Farms, Paid By options, default heads, limits
  firebase.js              Firebase setup (+ emulator switch for tests)
  state.js                 Data in memory
  domain/                  Pure logic: validation and report calculations (unit-tested)
  services/                Every Firestore / Auth call (data.js, auth.js)
  lib/                     Helpers: formatting, safe HTML, CSV, errors, image compression
  ui/                      One module per page + shared components, navigation, messages
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
