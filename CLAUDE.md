# Farm Tracker – engineering rules

These rules apply to every change in this project. Build like a senior engineer shipping a
scalable system for real users. Before writing code, briefly state the plan and ask about
anything unclear.

## Stack (from PRD.md, must follow)
- HTML, CSS, vanilla JavaScript ES modules. **No framework, no build step** for the app itself.
- Firebase 13.0.0 from the gstatic CDN: Authentication (Email/Password) and Cloud Firestore
  with offline persistence. Free Spark plan (no Cloud Functions, no Storage).
- Hosted on GitHub Pages; all paths relative (`./...`).
- Node is used only for development tooling (tests); nothing in `node_modules` ships.

## Security
- Validate every input twice: in the app (clear message) and in `firestore.rules` (enforced).
  Rules check types, allowed values, sizes and who is writing — not only the role.
- Never hardcode secrets. The Firebase web config is a public identifier, not a secret;
  security comes from the rules. Any real secret goes in an environment variable, never in git.
- No SQL here; the equivalent risks are unvalidated Firestore writes and over-broad reads.
  Give each role the least data it needs.
- XSS: every value placed in HTML goes through the shared escape helper. Prefer
  `textContent`. Never build HTML from unescaped data.
- Passwords are handled only by Firebase Auth (it hashes them). The app never stores passwords.

## Reliability
- Handle errors and edge cases: offline, permission denied, missing documents, empty data,
  oversized files, concurrent edits.
- Users get a short, clear message; developers get a `console` log with context.

## Performance and scale
- Efficient Firestore queries, needed composite indexes in `firestore.indexes.json`,
  caching where sensible. Nothing may break with 10,000+ users or a large number of entries.

## Quality and reusability
- Clean, simple, well-organized code; meaningful names; short comments (beginner-readable).
- No shortcuts, hacks, placeholders or "temporary" fixes.
- Anything used more than once becomes a shared function or module. Check for an existing one
  before adding a new one; refactor instead of duplicating.

## Testing
- Tests for every flow, action, feature and edge case, including failure cases.
- Run the full test suite before reporting a task as done.
- Never skip or delete a failing test to make it pass; fix the code.

## Version control
- Commit after each meaningful change: small, focused, clear descriptive messages.
- Never commit secrets or `.env` files.
- After changing any app file, bump `CACHE_VERSION` in `service-worker.js`.

## Maintainability
- Keep `README.md` current: setup steps and a short explanation of how the code is organized.

## Finishing a task
- Review the work for bugs and security holes, fix what is found, then give a plain-English
  summary of what was built and the risks that remain.
- Talk to the user in simple Roman Urdu / English.
