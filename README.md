# Farm Tracker – Setup Guide

A PWA to record daily inflow and outflow for Fatehpur, Bhakkarpur and Rehmanbad farms.
Full requirements are in [PRD.md](PRD.md).

## Files

| File | Purpose |
|---|---|
| `index.html` | All screens: login, add entry, entries list, reports, heads, users |
| `style.css` | Green theme, mobile layout, print layout for PDF |
| `app.js` | All app logic (login, roles, Firestore, reports, CSV export) |
| `firebase-config.js` | Firebase project config (do not change) |
| `manifest.json`, `service-worker.js`, `icons/` | PWA install and offline support |
| `firestore.rules` | Security rules to paste into Firebase Console |

## One-time Firebase setup

1. **Enable Email/Password login:** Firebase Console > Authentication > Sign-in method > Email/Password > Enable.
2. **Block public sign-up:** Authentication > Settings > User actions > untick "Enable create (sign-up)".
3. **Create Firestore:** Firestore Database > Create database (production mode).
4. **Security rules:** Firestore Database > Rules > paste the content of `firestore.rules` > Publish.
5. **Create the first Admin:**
   - Authentication > Users > Add user (your email + password). Copy the **User UID** shown in the list.
   - Firestore Database > Data > Start collection `users` > Document ID = the copied UID, with fields:
     - `name` (string): your name
     - `email` (string): your email
     - `role` (string): `admin`
     - `status` (string): `active`
6. Open the app and log in as Admin. The 12 default heads are created automatically.
7. **Authorized domain (after deploying):** Authentication > Settings > Authorized domains > add `<username>.github.io`.

## Adding more users

1. Firebase Console > Authentication > Users > **Add user** (email + temporary password). Copy the **User UID**.
2. In the app: **Users** > Add User > enter Name, Email, paste the UID, choose role.
3. Send the user the app link, email and temporary password. They can use **Change password** after logging in.

> Why the UID? Each `users` record must use the login's UID as its ID (security rules depend on it), and a
> browser app cannot look up a UID from an email on the free plan.

## Run locally

Open the folder in VS Code and use the **Live Server** extension (right-click `index.html` > Open with Live Server).
Opening `index.html` directly as a file will not work, because the app uses JavaScript modules.

## Deploy to GitHub Pages

1. Create a GitHub repository named `farm-tracker` and upload all files in this folder.
2. Repository > Settings > Pages > Source: "Deploy from a branch", Branch: `main`, folder `/ (root)` > Save.
3. After a minute the app is live at `https://<username>.github.io/farm-tracker/`.
4. Add `<username>.github.io` to Firebase authorized domains (step 7 above).

## Install on the phone

- **Android (Chrome):** open the link > tap **Install App** in the header (or menu > Install app).
- **iPhone (Safari):** open the link > Share > **Add to Home Screen**.

## Updating the app later

After changing any file, open `service-worker.js` and increase `CACHE_VERSION`
(for example `farm-tracker-v1` to `farm-tracker-v2`), so installed phones pick up the new version.
Phones load the new version on the next open after that.

## Attachments (payment slip / bill)
Each entry can optionally have one photo or PDF attached (Add Entry form > "Add photo or PDF").
Firebase Storage needs the paid Blaze plan, so attachments are stored in Firestore
(collection `attachments`, document id = entry id). Photos are compressed in the browser
to fit Firestore's 1 MB document limit; PDFs must be under about 650 KB.
After adding this feature, re-publish `firestore.rules` (it has an `attachments` rule).
