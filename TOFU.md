# Tofu gallery copy

This repository is Tofu's copy of **dohsimpson/HabitTrove** (licence: AGPL-3.0), listed in Tofu's app gallery on the
"organize" shelf as **HabitTrove**: a habit tracker that makes checking off fun, with streaks, coins for every check and
a wishlist of rewards you save up for, made to be used on a phone (it can be added to the home screen).

- `main` mirrors the upstream repository and is never committed to by Tofu.
- `tofu` carries Tofu's own changes, each commit with its reason; tags named `pin/<date>` mark the versions the
  gallery points to.
- A visitor who chooses this app gets a private snapshot of the pinned version in their own Tofu account. Their copy
  does not follow upstream updates.

Upstream: <https://github.com/dohsimpson/HabitTrove> at `5144d6106d8b20f1ed604caa34412a7f5a77a00e` (2026-03-07,
"fix: update package-lock.json for npm ci compatibility", version 0.2.31).

## How Tofu runs it

- Preset: `nextjs` (Next.js 15, App Router and server actions), on Tofu's server hosting. Root folder: the repository
  root.
- Install: `npm install` (the provider's default for Next.js with `package-lock.json`; it needs no flags, see
  [What Tofu changes](#what-tofu-changes)). Build: `npm run build` (`next build`). Output: `.next`, which the provider
  serves. `output: 'standalone'` stays in `next.config.ts` as upstream has it; the provider does not use it.
- Database: Tofu's managed PostgreSQL, created with the first deploy. Tofu saves `DATABASE_URL` (the transaction
  pooler, port 6543, `?sslmode=require`) and `SUPABASE_CA_CERT`; the app reads both (`lib/tofu-database.ts`).
- Schema: made by the app itself at start, not at build, and not from `supabase/migrations` (there is none). Every start
  runs `ensureSchema()` (`lib/store.ts`, called from `instrumentation.ts` and again on first use if that failed): when
  the two tables are missing, it takes `pg_advisory_xact_lock` inside one transaction, checks `pg_class` again, and
  makes them (`CREATE TABLE IF NOT EXISTS`). Several starts at once against a new database make them once; the others
  wait for the lock and log `schema: already made by another start`. A start that finds them logs
  `schema: found the tables`.
- Tables: `habittrove_documents` (one JSONB row per document: `settings`, `habits`, `coins`, `wishlist`, `auth`, with
  a `version` counter) and `habittrove_avatars` (one row per uploaded picture). Row-level security is on for both, with
  no policy, where the database has Supabase's `anon` and `authenticated` roles, so the Data API's public key reads and
  changes nothing; the app's own connection owns the tables and is not limited by it.
- Settings:

| Name | Value | Kind |
|---|---|---|
| `HABITTROVE_ADMIN_PASSWORD` | the password of the administrator account a new copy starts with (`admin`). Until it is saved, nobody can sign in, and the sign-in screen says so. | hidden: the owner saves it on the app's Keys & settings page, then deploys again |
| `SOURCE_URL` | where this copy's source code is. Tofu's gallery sets it to the pinned commit, `https://github.com/tofu-gallery/HabitTrove/tree/<the tag>`; unset, the link opens `https://github.com/tofu-gallery/HabitTrove` | public |
| `AUTH_SECRET` | optional: a random string of 32 or more characters. Unset, the app derives one from `DATABASE_URL` | hidden |
| `DEMO` | leave unset (upstream's demo mode) | public |

- There is no sign-up: only an administrator makes accounts (account menu, *Switch user*, *Add User*), so a copy has no
  sign-up setting to close.
- Changing `HABITTROVE_ADMIN_PASSWORD` changes the administrator's password from the next deploy, and does not sign out
  a phone that is already signed in. Saving a new `AUTH_SECRET` (or, while it is unset, a new database password,
  another database, or a restored one, which change the derived secret) signs everybody out once.

## What Tofu changes

Every file Tofu changed carries a dated `Modified by Tofu on 2026-10-28` note at its top, except the JSON files
(`package.json`, `package-lock.json`, `messages/*.json`), which take no comments and are listed here. New files say they
are Tofu's own.

- **Dependencies** (`package.json`, `package-lock.json`). `@emoji-mart/react` 1.1.1 and `react-day-picker` 8 declare
  React 16-18 as peers, so a plain `npm install` stopped with `ERESOLVE` against React 19 and upstream installs with
  `--force`. An `overrides` entry gives both the app's React, so the provider's plain `npm install` works; Tofu never
  uploads an `.npmrc`, which could otherwise say `legacy-peer-deps`. `pg` is added; `node-cron`, `archiver` and
  `web-push` (backups and push, removed below) and their types are removed; the `prepare` script (husky) is removed.
- **Data in PostgreSQL** (`lib/tofu-database.ts`, `lib/store.ts`, `lib/server-helpers.ts`, `app/actions/data.ts`,
  `app/api/avatars/[...path]/route.ts`, `instrumentation.ts`, `lib/env.server.ts`, `lib/avatar.ts`). Upstream keeps
  five whole JSON files in `data/` and avatars in `data/avatars`; Tofu's hosting has no lasting disk, so the same
  documents live in the two tables above. `lib/tofu-database.ts` verifies the database's TLS certificate against
  `SUPABASE_CA_CERT` as well as Node's own roots, taking the URL's own TLS parameters out (node-postgres reads
  `sslmode=require` as full verification against Node's roots only, which fails against the pooler); verification is
  never turned off. node-postgres prepares no named statement, so the transaction pooler is fine. A document's first
  read inserts its default with `ON CONFLICT DO NOTHING` and reads the row again, so two first requests at once make one
  `admin`, not two. Avatars are rows of `habittrove_avatars`, served by `/api/avatars/<name>` as before; they are at
  most 3 MB (upstream: 5 MB, more than a request may carry), and `next.config.ts` lets server actions take 4 MB.
- **No lost updates** (`lib/store.ts`, `lib/tofu-merge.ts`, `app/actions/data.ts`, `hooks/useHabits.tsx`,
  `hooks/useWishlist.tsx`, `hooks/useCoins.tsx`). Upstream read a whole document, changed it and wrote it back, and the
  browser sent whole lists, so two phones at once could undo each other's changes. Now every change locks its rows
  (`SELECT ... FOR UPDATE`) from read to write, and the habit and wish lists the browser sends come with the list it
  started from: only what that device changed is applied to the stored list, item by item and field by field (a habit
  it added, removed or edited, a check-off it added or undid), and everything another device did meanwhile stays.
  A coin note is changed on its own (`updateTransactionNote`) instead of the browser sending the whole ledger.
- **Every server action checks who is asking** (`app/actions/data.ts`). Each exported function of that file is a
  server action anyone on the internet can call. Upstream's `verifyPermission` was commented out; `createUser`,
  `updateUser` (which took `isAdmin` from the browser), `updateUserPassword`, `deleteUser` and `uploadAvatar` checked
  nobody; `getUser` (which returned the password hash) and `saveUsersData` (which wrote every account) were callable.
  Now internal helpers are not exported, every change needs a signed-in account, habit, wish and coin changes check the
  account's permissions on the server (checking off a habit or redeeming a wish needs "interact", anything else
  "write"), someone who is not an administrator only changes items assigned to them and their own coins, only an
  administrator makes, changes or deletes other accounts, and settings are checked (a language the app has, a real
  time zone).
- **Accounts on the public internet** (`lib/accounts.ts`, `auth.ts`, `lib/user-sanitizer.ts`, `lib/zod.ts`,
  `lib/types.ts`, `components/UserSelectModal.tsx`, `components/PasswordEntryForm.tsx`, `components/UserForm.tsx`,
  `messages/*.json`). A copy is online before its owner opens it. Upstream's first account, `admin`, had no password
  (an empty one signed in), and accounts could be made without one. Now every account needs a password, and the
  administrator account a new copy starts with signs in with `HABITTROVE_ADMIN_PASSWORD` (compared in constant time);
  while it is unset nobody can sign in, and the sign-in dialog says so in each of the app's nine languages (the new
  `Tofu` messages). That account cannot be given another password in the app, demoted or deleted (its form says where
  its password comes from), so the owner always keeps a way in. Passwords may be up to 128 characters (upstream: 32).
  Auth.js gets its secret from `AUTH_SECRET` or, unset, one derived from `DATABASE_URL` (`authSecret()`): only the
  app's hosting and its owner hold `DATABASE_URL`, and anyone holding it can already change every row. A wrong
  password is Auth.js's own `CredentialsSignin`.
- **No backups, no data-folder check** (removed `lib/backup.ts`, `lib/scheduler.ts`, `app/debug/backup/page.tsx`,
  `lib/startup-checks.ts` and its test, `components/PermissionError.tsx`, `components/RecheckButton.tsx`; changed
  `components/Layout.tsx`, `app/settings/page.tsx`, `lib/types.ts`). Upstream zipped `data/` into `backups/` at 2 AM
  from an in-process scheduler, and wrote a test file into `data/` on every page to show a "Permission Error" banner.
  A copy on Tofu runs nothing between requests and has no data folder; Tofu's managed database keeps daily backups.
  The *Auto Backup* setting is gone.
- **No push notifications or service worker** (removed `app/actions/push.ts` and `public/sw.js`; changed
  `app/layout.tsx`, `next.config.ts`). The push action was never called and set up `web-push` with upstream's own
  address; the service worker only showed push notifications. Nothing in a copy sends notifications or reminders, so
  nothing offers them. The web app manifest stays (the app can be added to a phone's home screen), and
  `app/layout.tsx` adds an icon for iPhones. `next.config.ts` traces `CHANGELOG.md`, which the About dialog reads,
  into the server build.
- **A generated chime** (`lib/utils.ts`, removed `public/sounds/timer-end.wav`). The sound played when a habit's
  target is reached came with no statement of its source or licence; `playSound` now makes a short two-note chime with
  the Web Audio API.
- **Source code link** (`components/UserSelectModal.tsx`, `components/AboutModal.tsx`, `app/actions/data.ts`
  `loadServerSettings`): see [Source code](#source-code).
- **Built as a Next.js app** (removed `Dockerfile`, `.dockerignore`, `docker-compose.yaml`,
  `.github/workflows/docker-publish.yml`, `.husky/pre-commit`). Upstream's container (user `nextjs`, port 3000, `data/`
  and `backups/` volumes) would not run on Tofu, which has no volume, and a root `Dockerfile` makes Tofu's detector
  answer `container` for an upload of this fork. The workflow pushed that image to upstream's Docker Hub account; the
  git hook is upstream's release check, which the removed `prepare` script installed. `.github/workflows/test.yml`
  stays (it runs upstream's tests on pull requests).
- **Phone layout** (`components/UserForm.tsx`): on a 390-pixel phone the account form's buttons now wrap instead of
  cutting "Delete Account" off.
- `TOFU.md`: this file.

Nothing else changed. The bun tests that remain (`lib/utils.test.ts`, `components/CoinBalance.test.tsx`,
`app/actions/data.test.ts`) were not run (bun is not installed here); `tsc --noEmit` passes.

## What works differently on Tofu

- No reminders, alerts or push notifications, and no email (the app has none of its own): the app only answers
  requests.
- No in-app backups; the managed database is backed up daily by Tofu.
- While the app is open it asks every 30 seconds whether the data changed elsewhere and offers a *Refresh* banner; it
  does not update the screen by itself.
- Every account has a password; the administrator a new copy starts with uses `HABITTROVE_ADMIN_PASSWORD`.
- Avatars are at most 3 MB.
- The time zone starts as the server's (UTC) until someone sets it under *Settings*, as upstream does on a server in
  UTC.
- As upstream, the sign-in screen lists every account's name and picture to anyone who opens the copy, and the
  household's settings (language, time zone) are shared by every account.

## Source code

AGPL-3.0 section 13 asks a changed copy that people use over a network to offer them its source code.

- A **Source code** link at the foot of the sign-in dialog, which everyone who opens the copy sees before signing in,
  and a **Source code** button in the About dialog (which replaces upstream's "Star on GitHub" button to upstream's
  repository) open `SOURCE_URL`, read on the server at each request. The credit to the author's GitHub profile stays.
- Tofu's app gallery saves `SOURCE_URL` as the pinned commit's tree when it makes a copy, so the link opens exactly the
  code the copy runs. Unset (or not an `http(s)` address), the links open this repository.
- An owner who changes the code must point `SOURCE_URL` at their own source and deploy again.

## Licence

AGPL-3.0, unchanged in `LICENSE`. Upstream's copyright and the GNU licence text stay exactly as they are; upstream
states no other copyright lines. The name HabitTrove and its treasure-chest logo and icons (`public/icons/`) are
upstream's and are kept as they are. The DM Sans font (SIL Open Font License 1.1) is fetched from Google Fonts by
`next/font` when the app is built and served by the app itself; visitors' browsers never ask Google. The emoji picker's
data comes from `@emoji-mart/data` (MIT).

## Verification (2026-10-28, on this Mac; no deployment)

- Install: in a `git archive` of the code commit `cea14a8` with every execute bit removed (`find -type f -exec chmod
  a-x`; 158 files, none executable), as Tofu delivers files, `npm install` (no flags) added 720 packages and left
  `package-lock.json` unchanged; `npm run build` compiled. Before the
  `overrides`, the same `npm install` on upstream's commit stopped with `ERESOLVE` (`@emoji-mart/react` wants React
  18). `npx tsc --noEmit` passes. The build needs no database settings.
- Database: a throwaway local PostgreSQL 14 database per run. Five `next start` processes of that build started at the
  same moment on five ports against one empty database: all five came up and answered `GET /` with 200; one logged
  `schema: made the tables (waited 0 ms for the lock)` and four `schema: already made by another start (waited 19-20 ms
  for the lock)`; both tables had row-level security on (the local server has `anon` and `authenticated` roles), and
  the five first requests made one `auth` document (version 1) with one `admin`. Twenty first requests at once across
  the five, on emptied tables, all answered 200 with the same `admin` id, and one `auth` document (version 1) held one
  account. (A first run showed every start logging "made the tables": the re-check inside the lock used `to_regclass`,
  which answers from a cache; it now reads `pg_class`.)
- TLS: against a scratch PostgreSQL that only accepts TLS (`hostnossl ... reject`) with a certificate from a private
  CA, and `HOME` set to a folder with mode 000, the build with `DATABASE_URL=...?sslmode=require` and the CA in
  `SUPABASE_CA_CERT` answered 200 and made the tables; without `SUPABASE_CA_CERT` it answered 500 with `unable to
  verify the first certificate`. The app reads no file under `HOME`: node-postgres is not libpq and reads no default
  client certificate, and no process changes user.
- Tofu's live check (`live-check.py`, kept with the gallery's records, not in this repository) against that build, with `SOURCE_URL` set to the pin: on a copy without
  `HABITTROVE_ADMIN_PASSWORD`, the page carries `adminPasswordMissing: true` and the sentence naming it, the pin's
  source link, no session; a habit saved without a session is refused; signing in to `admin` with a password and with
  none is refused (`CredentialsSignin`): RESULT PASS. With the password saved: a wrong one is refused, the right one
  gives a session, a habit is made, read back, checked off once, its 2 coins recorded and shown on `/coins`, and a
  visitor without a session sees none of it: RESULT PASS.
- Two devices: two signed-in sessions saved, at the same moment and from the same starting list, one checking off
  habit A and the other habit B: both check-offs were kept. A device that had never seen habit B then renamed habit A:
  B stayed, and A kept its check-off.
- Browser (headless Chromium, light theme): at 390x844 (phone, touch) and 1200x750, `/` signed out and `/`, `/habits`,
  `/wishlist`, `/calendar`, `/coins`, `/settings` signed in: no page errors and no console errors, nothing wider than the
  screen, and on the phone the last content of a scrolled page ends above the bottom bar. On the phone, through the
  app's own screens: sign in to `admin` with the password, add a habit with *Add Habit*, check it off (coins 2 to 3),
  try a new account without a password (refused: "Every account needs a password."), make it with one, sign out, sign
  in as it, and it does not see the administrator's habit. Without `HABITTROVE_ADMIN_PASSWORD` the sign-in dialog shows
  the sentence once, `admin` offers no password field, and *Login* stays disabled.

## What only a real deploy can verify

- The provider's install and build: `npm install` with the `overrides` on its Node version, `next build` with
  `output: 'standalone'`, `instrumentation.ts` at each cold start, and `CHANGELOG.md` in the About dialog.
- The managed database through the transaction pooler: TLS with the real `SUPABASE_CA_CERT`, transactions with
  `FOR UPDATE` and the advisory lock across several starts, and row-level security against the Data API's roles.
- The owner saving `HABITTROVE_ADMIN_PASSWORD` as a hidden value and deploying again, then signing in with it.
- An avatar of up to 3 MB through the provider's request limit.
- Sign-in cookies on https (`__Secure-` names) and the session after a cold start.
