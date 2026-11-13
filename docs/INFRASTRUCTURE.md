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

**Where the domain lives (checked 2026-10-12, 9:57 am MT; still true
2026-11-02).**

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

**The public website: `wavecenter.com` and `www.wavecenter.com` (live
2026-11-02).** Both names point at StarCaster, which serves the Builder site
of its project named **WaveCenter** (`proj_1791864939045_feolj2`, Domain field
`wavecenter.com`; StarCaster treats `www.` as the same site). Three pieces
make it work:

1. **Vercel.** Both names are attached to the Vercel project `starcaster`
   (`vercel domains add wavecenter.com starcaster --scope dane-of-earth`, and
   the same for `www.`), never to `app-wavecenter`.
2. **Hostinger DNS** (Dane, 2026-11-02):

   | Type | Name | Value |
   |---|---|---|
   | `A` | `@` | `216.150.1.1` |
   | `A` | `@` | `216.150.16.1` |
   | `CNAME` | `www` | `f5b13d86a18c7f78.vercel-dns-017.com` |

   The parking-page `A` (`82.180.172.168`) and `AAAA`
   (`2a02:4780:b:860:0:8f9:99c1:4`) records were deleted. A leftover `AAAA`
   sends visitors on IPv6 networks to Hostinger's parking page. The MX, SPF
   and `app` records were not touched.
3. **StarCaster.** The site's front page is the published, non-private page
   whose address is `home` (or blank). StarCaster's guide is
   `docs/CUSTOM_DOMAIN_PUBLIC_SITES.md` in the StarCaster repository.

Checked 2026-11-02, 1:37 pm MT: `https://wavecenter.com`,
`https://www.wavecenter.com` and `https://app.wavecenter.com` all answer
`200`. The first two carry their own Let's Encrypt certificates and the header
`x-site-handler: resolved` (StarCaster found the WaveCenter site). The
certificates arrived about 35 minutes after the DNS change. While they were
pending, Chrome showed `ERR_QUIC_PROTOCOL_ERROR`, which means "no certificate
yet", not a DNS fault.

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
Everything runs on the server, with one exception: live updates. Every query
runs as the signed-in member, so row-level security decides what comes back,
and app code never reads the service role key.

**Live updates (since WC-172, 2026-11-12).** A task's Discussion updates while
it is open, through Supabase Realtime: the browser connects to Supabase
directly and is told when a comment is posted, edited or deleted
(`app/lib/realtimeClient.ts`, the one helper for it; the chat window reuses
it). For that, the browser holds the project address and the **anon key**,
and nothing else. The anon key is the public key: it is safe in a browser
only because row-level security decides what it can read, and Realtime
checks the same rules for every listener, so a browser hears only about rows
its signed-in member may read and a signed-out visitor hears nothing. The
server page hands the two settings to the browser per request, read through
`supabaseSettings()`, never baked in at build (engineering rule 4). The
service key never goes to the browser (rule 3). Realtime is part of
open-source Supabase, not a Vercel feature, so it works on any host (rule
11). A table is heard live only once it is in the `supabase_realtime`
publication (a migration adds it). `npm run check:browser-secrets` (part of `verify`) fails the build if a
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

**Email limits.** Supabase's built-in sender only delivers to members of the
Supabase organisation, a few emails an hour. That is enough for Dane; it must
change before anyone else is invited. The fix is custom SMTP through Resend,
step 4 of [EMAIL_SETUP.md](EMAIL_SETUP.md), which also raises the hourly limit.
Until Dane has done that step, sign-in links still use the built-in sender.

**Email to members.** An admin's message from the Members page is emailed
through **Resend** (Dane's choice, 2026-10-30), by its plain HTTPS API, so it
works on any host (`app/lib/mailer.ts`). Gmail does not let another service
send as a gmail.com address, so the email comes from
`WaveCenter <noreply@wavecenter.com>` (Dane's choice, 2026-11-01) on
`wavecenter.com`, verified in Resend, and replies go to Dane's Gmail. Without
`RESEND_API_KEY` the message is still saved, and the form says plainly that
it was not emailed. **How to switch it on, click by click:
[EMAIL_SETUP.md](EMAIL_SETUP.md)** (verify the domain at Hostinger, make a
sending-only key, put it in Doppler `dev` and `prd` and in Vercel, redeploy).
`npm run email:test -- --to <address>` sends one test email and says plainly
whether it went; `npm run doctor` shows whether the key is in Doppler.

**The AI that rates tasks.** Not the website: a lane on the **Mac Mini**,
under Dane's monthly Claude plan (Dane, 2026-11-04: "We need to adjust this
feature so it uses the monthly Anthropic account instead of API quota", then
"go with the Mini"). Every 30 minutes the launchd agent
`com.wavecenter.ai-rating` runs `scripts/rating_lane.sh`, which runs
`npm run rate-tasks`: up to 10 open tasks, each rated by `claude-opus-5-5` and
`claude-sonnet-5-5` through headless Claude Code (`claude -p`) with every
tool switched off, in an empty scratch folder, with a bare environment
(`scripts/lib/claudeCodeRater.mjs`). Doppler gives the pass only
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`--only-secrets`).
**Nothing uses an AI key**: no code reads `ANTHROPIC_API_KEY`, the lane
unsets it, and the pass refuses to start if one is in its environment, because
Claude Code would then bill the API account instead of Dane's plan. Each pass
logs which sign-in it used (for example `claude.ai (max plan)`) to
`~/loop-logs/wavecenter-ai-rating.log` and leaves a report the Admin page
shows. **Limits:** ratings share Dane's plan's usage with the build and
review lanes (10 tasks a pass is the control); they pause when the Mini is
off or its Claude sign-in expires (the Admin page then says the lane has
stopped). Before inviting other members, re-check Anthropic's terms on using
a personal plan to rate other people's tasks; moving to an API key is one
`TaskRater` swap.

**The Evolution pictures.** Also a lane on the **Mac Mini**, plain node
under Doppler with no Claude session. Every 10 minutes the launchd agent
`com.wavecenter.evolution` runs `scripts/evolution_lane.sh`:
`npm run evolution -- missing` takes the picture of each change on `main`
that has none yet, then `recapture --if-rules-changed` retakes old cards when
a merge changed the picture rules. Until the move to Spirality's loop these
ran inside WaveCenter's merge lane; Spirality's relay merges now and runs no
step of WaveCenter's, so the pictures have their own lane (WC-165). Each
change's ticket is found from its pull request's `Ticket:` line and read
from the tracker (`npm run wavecenter -- ticket-json`; ClickUp tickets from
before the move are still read from ClickUp), signed in as the relay's seat.
It needs Playwright's headless browser, which the installer puts in;
`scripts/install_loop_runner.sh --status` shows whether it starts. Log:
`~/loop-logs/wavecenter-evolution.log`.

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
| `RESEND_API_KEY` | the Resend key (sending access only) that sends members' messages, and, as the SMTP password in Supabase, sign-in links. In `dev` and `prd`; setup in [EMAIL_SETUP.md](EMAIL_SETUP.md) | **server only** |
| `MESSAGE_FROM` | optional; the address messages come from. Default `WaveCenter <noreply@wavecenter.com>` | server |

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
