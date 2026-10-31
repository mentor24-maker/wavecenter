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

### Where a database change goes, and when

There are two databases. Only one of them is real.

- **The live database** (above). A change reaches it only through the merge
  lane, on Dane's written `merge`: the lane applies the PR's new files in
  `supabase/migrations/` just before it merges the PR, and says on the ticket
  what it applied (`docs/LOOP_ENGINEERING.md`, "The merge lane"). Nobody and no
  session applies an unmerged migration to it. (2026-10-29: a build applied
  PR #44's migration early, it had a bug, and the live member list failed for
  about five minutes.)
- **The test database**, private to the Mac Mini, free (Dane's choice,
  2026-10-29: "B it is"). `npm run db:test` starts WaveCenter's own local
  Supabase in Docker (`colima`), rebuilds it from every migration in the
  folder it runs from, and runs `scripts/check_tasks_rls.mjs` against it. Its
  settings are `supabase/config.toml`. StarCaster's local stack on the Mini
  uses the default ports +100 (544xx), so WaveCenter's uses +200: API
  `127.0.0.1:54521`, database `127.0.0.1:54522`. Its keys are Supabase's
  published local-development defaults, read from `supabase status` at run
  time, never the live ones; `db:test` refuses any address not on this
  machine. One run at a time (a lock); the stack stays up between runs
  (`supabase stop` to stop it). `auto_expose_new_tables = true` in the config
  makes it grant table access the way the live project does.

## Hosting: Vercel

| | |
|---|---|
| Team | Dane Christensen's projects (`dane-of-earth`) |
| Project | `app-wavecenter` (id `prj_jo8rGoJlF55XwB2QuJ2srLVoqQdF`; named `wavecenter` until 2026-10-11) |
| Address | https://app.wavecenter.com (live 2026-10-12, HTTPS by Let's Encrypt via Vercel) |
| Vercel address | https://app-wavecenter.vercel.app, the same app; keeps working |
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
and its address is `app.wavecenter.com` (also `app-wavecenter.vercel.app`).
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

## The domain: wavecenter.com

**Which name goes where (Dane, 2026-10-11).**

| Name | What it is | Served by |
|---|---|---|
| `app.wavecenter.com` | **this app** (this repository) | Vercel project `app-wavecenter` |
| `app-wavecenter.vercel.app` | the same app, its permanent Vercel address; keeps working | Vercel project `app-wavecenter` |
| `wavecenter.com` | WaveCenter's **public website**, built on StarCaster | StarCaster, never this project |
| `www.wavecenter.com` | the same public website | StarCaster, never this project |

**Where the domain lives (checked 2026-10-12, 9:57 am MT).**

| | |
|---|---|
| Registrar (who the name is rented from) | GoDaddy; renews by 2027-02-05; Dane is moving it, and no transfer is in progress yet |
| DNS (the address book that says which server answers each name) | Hostinger (name servers `ns1.dns-parking.com`, `ns2.dns-parking.com`) |
| Email on the domain | Hostinger email is live: `MX 5 mx1.hostinger.com`, `MX 10 mx2.hostinger.com`, SPF `v=spf1 include:_spf.mail.hostinger.com ~all` |

**DNS stays at Hostinger (Dane chose option A, 2026-10-12).** The app needs
just one record there, which leaves email untouched and costs nothing:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `app` | `cname.vercel-dns.com` |

Vercel also has to be told the name belongs to the project (Project →
Settings → Domains → add `app.wavecenter.com`, or `vercel domains add
app.wavecenter.com app-wavecenter`). If Vercel's Domains page shows a
different CNAME value when the name is added, use the one it shows. Once both are in, Vercel issues the
HTTPS certificate on its own within minutes. A plain CNAME is an ordinary DNS
record, so the address moves with the app to any other host.

**Live since 2026-10-12.** Both steps are done: the Hostinger record is in and
the name is attached to the project. Checked 2026-10-12, 7:35 pm MT:
`https://app.wavecenter.com` answers `200` from Vercel with a Let's Encrypt
certificate for `app.wavecenter.com`.

**"DNS Change Recommended" on Vercel's Domains page is not an error.** Vercel
now hands each project its own CNAME target (shown under "View DNS
configuration") and nudges older `cname.vercel-dns.com` records toward it. The
old target keeps working and the yellow badge stays until the record is
changed. Swapping it is optional: change the Hostinger `app` record's value to
the target Vercel shows, then click Refresh.

**Never move the name servers while email depends on them.** Moving DNS to
Vercel (as `starcaster.pro` does) would mean copying both MX records and the
SPF record across first; a missed record silently stops email. The GoDaddy
transfer changes only the registrar and does not need the name servers to
move. Supabase's sign-in links follow the app to its new name: Dane made
`https://app.wavecenter.com` the Site URL and added it to the Redirect URLs on
2026-10-12, 7:48 pm MT (see the table below).

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
| Site URL | `https://app.wavecenter.com` |
| Redirect URLs | `https://app-wavecenter.vercel.app/**` |
| | `https://app.wavecenter.com/**` |
| | `https://app-wavecenter-*-dane-of-earth.vercel.app/**` (every preview) |
| | `http://localhost:3000/**` (local development) |

**Add every new address to the list.** When `app.wavecenter.com` went live
(2026-10-12) it was missing from Redirect URLs, so a link asked for there
silently fell back to the Site URL and opened `app-wavecenter.vercel.app`.
Any new domain the app answers on needs a Redirect URL entry the same day.

**A link only works in the browser that asked for it** (Supabase's PKCE flow:
the request leaves a matching cookie). Opening the email on a phone after
asking on a laptop shows "That sign-in link did not work".

**Email limits.** Until WaveCenter has its own email service (custom SMTP in
Supabase), Supabase's built-in sender only delivers to members of the Supabase
organisation and only a few emails an hour. That is enough for Dane; it must
change before anyone else is invited.

**Email to members.** An admin's message from the Members page is emailed
through **Resend** (Dane's choice, 2026-10-30), by its plain HTTPS API, so it
works on any host (`app/lib/mailer.ts`). Gmail does not let another service
send as a gmail.com address, so the email comes from a WaveCenter address on
a domain verified in Resend, and replies go to Dane's Gmail. Without
`RESEND_API_KEY` the message is still saved, and the form says plainly that
it was not emailed. The key goes into Doppler `wavecenter` (`dev` and `prd`)
and into Vercel for Production and Preview, then a redeploy (rule 4). This is
separate from the sign-in links above, which still use Supabase's sender.

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
| `RESEND_API_KEY` | the Resend key that sends members' messages by email (see "Email to members" below) | **server only** |
| `MESSAGE_FROM` | optional; the address messages come from. Default `WaveCenter <messages@wavecenter.com>` | server |
| `MESSAGE_REPLY_TO` | optional; where replies go. Default `daneofearth@gmail.com` | server |

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
