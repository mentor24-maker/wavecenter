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

## Keys: Doppler

Doppler project **`wavecenter`**, workplace Alphire. Configs: `dev`, `stg`,
`prd`, and a personal `dev_personal`.

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
value in each config.

Run any command with the keys by wrapping it in Doppler:

```bash
doppler run --project wavecenter --config dev -- <command>
```

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
