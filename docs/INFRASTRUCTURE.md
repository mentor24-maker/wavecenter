# WaveCenter infrastructure

What WaveCenter runs on and where each piece lives. **No key, password or token
appears in this file or anywhere in the repository** (it is public). Secret
NAMES appear here; values live only in Doppler.

WaveCenter has its own Supabase, Vercel and Doppler projects, separate from
StarCaster's, so a failure in one cannot take down the other (StarCaster's
shared database disk filled on 2026-08-17 and took every client site down).

## Database: Supabase

| | |
|---|---|
| Project name | WaveCenter |
| Project ref | `dewzjgnydxwwblfuvyhb` |
| Project URL | https://dewzjgnydxwwblfuvyhb.supabase.co |
| Dashboard | https://supabase.com/dashboard/project/dewzjgnydxwwblfuvyhb |
| Created | 2026-10-11, by Dane, in the Alphire / mentor24 Supabase account |
| Region | US East (Ohio), `us-east-2` |
| Database | PostgreSQL 17 |

### Connecting: IPv4 pooler, not the direct host

The default direct host, `db.dewzjgnydxwwblfuvyhb.supabase.co`, has **only an
IPv6 address**. Dane's Mac and network cannot reach IPv6, so a connection there
fails with "host unreachable" even though the password is right. WaveCenter's
`DATABASE_URL` therefore uses Supabase's **shared transaction pooler**, which
has an IPv4 address:

- host `aws-0-us-east-2.pooler.supabase.com`, port `6543`
- user `postgres.dewzjgnydxwwblfuvyhb` (the project ref is part of the user name)
- database `postgres`

Do not buy the "IPv4 add-on" (a paid dedicated address) to get around this.
A transaction pooler suits serverless functions, which is what Vercel runs. It
does not support some session features (prepared statements, `LISTEN`); use
the session pooler or the direct host for a migration tool if one needs them.

## Hosting: Vercel

| | |
|---|---|
| Team | Dane Christensen's projects (`dane-of-earth`) |
| Project | `app-wavecenter` (id `prj_jo8rGoJlF55XwB2QuJ2srLVoqQdF`; named `wavecenter` until 2026-10-11) |
| Address today | https://app-wavecenter.vercel.app |
| Address later | `app.wavecenter.com`, once the domain is transferred |
| Source | GitHub `mentor24-maker/wavecenter`, production from `main`, a preview for every pull request |
| Framework | Next.js (TypeScript), standard hosting only |
| Created | 2026-10-11, from the command line (`vercel link`, `vercel git connect`) |

**Two things learned connecting it (2026-10-11).** `vercel git connect` sets
the project's **production branch to whatever branch the command is run
from**. Run from a feature-branch worktree, it made that branch production and
deployed it to `wavecenter.vercel.app` before any merge; reconnecting from a
checkout on `main` fixed it, and a push to a feature branch then deployed as a
preview. Run Vercel git commands from the main checkout, on `main`. Second:
**preview deployments require a Vercel sign-in to view** (deployment
protection, "all except custom domains"), so a preview link in a ticket works
for Dane, who is signed in, and for nobody else. Production at
`app-wavecenter.vercel.app` is public.

**Two sites, two homes (Dane, 2026-10-11).** This repository is **the app**,
and its address is `app.wavecenter.com` (interim: `app-wavecenter.vercel.app`).
WaveCenter's **public website** — the DEO story, the invitation — is a separate
site built on **StarCaster** at `wavecenter.com` / `www.wavecenter.com`. The
bare and `www` names never point at this project.

**No Vercel-only features.** Dane's condition for choosing Next.js
(2026-10-11): the whitepaper says any part of the stack is replaced if it
threatens capture, so the site must stay movable to another host. Use only
what plain Next.js offers on any host. Before enabling anything in the Vercel
dashboard or `next.config.ts`, ask whether it would work elsewhere.

**Vercel bakes environment variables in at build time** (engineering rule 4).
Changing one in the dashboard does nothing until a redeploy. Sign-in needs
two, `SUPABASE_URL` and `SUPABASE_ANON_KEY`, set for **Production and
Preview**. Neither is `NEXT_PUBLIC_`: the app reads them on the server only,
and a deployment without them says so on `/sign-in` instead of breaking.


**`main` never deploys unchecked** (rule 1). Branch protection on `main`
requires a pull request and the `verify` status check, with the branch up to
date, and applies to administrators too. Force-pushes are refused. It was set
on 2026-10-11 with:

```bash
gh api -X PUT repos/mentor24-maker/wavecenter/branches/main/protection --input protection.json
```

where `protection.json` names `required_status_checks.contexts: ["verify"]`,
`strict: true`, `enforce_admins: true` and
`required_pull_request_reviews.required_approving_review_count: 0`.

**Proved, not assumed (2026-10-11, PR #7):** a pull request carrying one
deliberately failing test turned `verify` red; `gh pr merge` was refused with
*"the base branch policy prohibits the merge"*, `gh pr merge --admin` was
refused with *"Required status check 'verify' is failing"*, and the PR showed
`BLOCKED`. It was closed unmerged and its branch deleted. Repeat that test
whenever the protection settings are touched.

## Sign-in: Supabase Auth, email magic link

Members sign in with a one-time link emailed to them (a "magic link"): no
password. Dane chose this on 2026-10-11 over Google sign-in because it fits
the invitation model to come.

**How it works.** `/sign-in` takes an email; a server action asks Supabase to
email a link. The link goes to Supabase, which checks it and sends the browser
to `/auth/confirm` on the same site with a one-time code; that route trades
the code for a session cookie and sends the member to `/`. `proxy.ts` renews
the session cookie before each page request (a session token lasts an hour).
Everything runs on the server: the browser holds **no Supabase key at all**,
only the session cookie, and app code never reads the service role key. Every
query runs as the signed-in member, so row-level security decides what comes
back. `npm run check:browser-secrets` (part of `verify`) fails the build if a
server-only secret's name appears in anything shipped to the browser.

**Supabase dashboard settings** (Authentication → URL Configuration). Supabase
only sends a link back to an address on its list; anything else falls back to
the Site URL. Out of the box the Site URL was `http://localhost:3000`, so a
link asked for from the live site landed on localhost (checked 2026-10-11).

| Setting | Value |
|---|---|
| Site URL | `https://app-wavecenter.vercel.app` (later `https://app.wavecenter.com`) |
| Redirect URLs | `https://app-wavecenter.vercel.app/**` |
| | `https://app-wavecenter-*-dane-of-earth.vercel.app/**` (every preview) |
| | `http://localhost:3000/**` (local development) |

**A link only works in the browser that asked for it** (Supabase's PKCE flow:
the request leaves a matching cookie). Opening the email on a phone after
asking on a laptop shows "That sign-in link did not work".

**Email limits.** Until WaveCenter has its own email service (custom SMTP in
Supabase), Supabase's built-in sender only delivers to members of the Supabase
organisation and only a few emails an hour. That is enough for Dane; it must
change before anyone else is invited.

## The core is separate from the framework

`core/` holds the task record, the points rules and the who-may-do-what
rules: plain TypeScript, its own tests, and **never an import of Next.js,
React or Vercel**. The website in `app/` is the first client of the core;
member-built tools are later clients. `npm run check:core-boundary` enforces
it and `verify` runs it. (Dane's condition, 2026-10-11.)

## Keys: Doppler

**What Doppler is.** Doppler is an online safe for keys: passwords, tokens and
connection strings. Instead of keeping keys in a file on a computer (where they
get copied, committed or screenshotted by accident), WaveCenter keeps every key
in Doppler and hands them to a program only at the moment it runs. Nothing
secret is ever written into this repository.

A Doppler **project** holds the keys for one product; a **config** is one set
of those keys for one setting. WaveCenter's project is **`wavecenter`**
(workplace Alphire). `dev` is what agent sessions and scripts use, `prd` is
what the live site uses, `stg` is for a future staging copy, and
`dev_personal` is a personal scratch copy.

**How an agent session runs a command with keys.** Wrap the command in
`doppler run`, which starts it with the keys loaded and forgets them when it
ends:

```bash
doppler run --project wavecenter --config dev -- <command>
```

`npm run clickup` already does this for the ClickUp script.

**Checking the setup: `npm run doctor`.** It asks Doppler which key NAMES each
config holds (never the values) and prints a table of every expected name
against `dev` and `prd`: `present`, `MISSING`, or `not needed` for a key that
config does not use. It exits 0 when everything is there and 1 otherwise. The
expected names live in one place, `scripts/lib/expectedSecrets.mjs`; a ticket
that adds a key adds its line there.

**Catching a leaked key: `check:secrets`.** Part of `npm run verify`, so it
runs locally and in CI on every pull request. It fails if any file in the
repository is a `.env` file, or contains something shaped like a ClickUp
`pk_` token or a Supabase service key. If it ever fires on a real key, removing
the file is not enough: the repository is public, so rotate the key in its own
dashboard.

| Secret name | What it is | Where it may be used |
|---|---|---|
| `SUPABASE_URL` | the project address (not secret) | browser and server |
| `SUPABASE_ANON_KEY` | the public key; safe in a browser only because row-level security decides what it can read | browser and server |
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses row-level security entirely | **server only, never the browser** |
| `DATABASE_URL` | the Postgres connection string, with the database password | **server only** |
| `CLICKUP_API_TOKEN` | the ClickUp token, a reference to StarCaster's `dev` config | scripts only |

`stg` and `prd` hold the three Supabase names as **references** to `dev`
(`${wavecenter.dev.<NAME>}`), because there is one Supabase project for now.
When WaveCenter gets a separate production database, replace the `prd`
references with that project's own values. `DATABASE_URL` is stored as a plain
value in each config. `CLICKUP_API_TOKEN` is only in `dev`, because only
scripts use it.

**A secret value is only ever entered through the Doppler dashboard**, never
typed into a terminal and never pasted into a chat, a file or a commit.
Doppler's save button is the purple **Save** in the upper right of the config
page. A tab left open while someone else changes the same config is refused
with "The secrets on this page are out of date"; reload the tab and re-enter
only the row you were on.

## Rules that apply here

- Every new table turns on row-level security in the migration that creates
  it (CLAUDE.md, engineering rule 2).
- The service key and database URL never reach browser code (rule 3).
- Vercel bakes environment variables in at build time, so changing one in the
  dashboard does nothing until a redeploy (rule 4).

## History

- 2026-10-11: project created; four keys stored; the first database password
  and the second were each exposed in a screenshot shared with an assistant
  session and were reset before use. Connection verified through the IPv4
  pooler (PostgreSQL 17.11, role `postgres`).
