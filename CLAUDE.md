# WaveCenter — rules for every agent session

Read this file first, then [docs/MISSION.md](docs/MISSION.md). Together they
say what WaveCenter is for and how to work on it.

**This repository is public.** Anyone can read every file and every commit.
Never commit a key, password, token or `.env` file. Keys live in Doppler.

## What we are building

WaveCenter is the hub of the DEO movement and the original DEO (Decentralized
Engagement Organization). The canon is the DEO whitepaper, *White Paper: The
Decentralized Engagement Organization — Dane v2*, in Dane's Google Drive `DEO`
folder. Do not fill gaps in the canon from guesswork. Ask Dane.

The path, in order:

1. A simple to-do list, built by Dane and Claude Code.
2. It grows into a basic project management tool modeled on ClickUp.
3. Dane uses that tool to plan a more robust project management system.
4. That system has a **game layer built into the substrate**: every
   contribution is captured, valued in points, and credited to the member who
   made it. It is part of the foundation, not a feature added later.
5. The plan is broken into tasks with defined points, and other people are
   invited in through the platform. That is how the project bootstraps itself.

The to-do list is a seed, not a throwaway prototype. Every design choice must
leave room for steps 2–5. In particular, a task record carries an owner, a
status, a parent task and a points value from the very first version.

## How to work with Dane

- **Plain language, always.** Dane directs the project. Explain any technical
  term the first time it matters, and never bury a decision in jargon.
- **Coach in the moment, kindly.** When Dane is about to do something risky
  (working directly on `main`, pushing without a passing build, running two
  sessions in one folder), say so plainly, give the risk in one sentence, and
  offer the safer step. He has asked to learn best practice as the work goes
  on, so coaching is part of every task.
- **Agent sessions run the commands, not Dane.** Scripts, deploys, database
  setup, git: run them and report the result in plain English. Hand something
  to Dane only for one of four reasons, and say which: a **real secret
  value**, a **billing screen**, a **browser login**, or a **decision that is
  genuinely his**. A refused permission is not one of the four; retry when
  the step comes back around.
- **An agent session is never a "person".** "Person", "human", "somebody" and
  "anyone" mean Dane or another real human. Every hand-off names who acts.
- **Housekeeping is silent.** Clean up stale branches, scratch files and
  leftover folders without asking or explaining. Interrupt only when Dane
  himself is causing a problem.
- **Show, don't just tell.** Dane cannot see command output. Paste what
  matters into the reply. Test steps are a clickable link plus the exact
  clicks and what he should see.
- **Times in Mountain time**, never UTC.
- **Name tickets by their exact title.** Titles say in plain words what breaks
  and who feels it.
- **"Done" means verified.** Passing checks, and for anything visible, a
  sentence saying which screen you opened and what you saw. "It should work"
  is not done.

## Where the work is tracked

Every piece of work on this repository is a ticket in the **Loop Queue** list
of the **WaveCenter** space in ClickUp (list id `901422159126`). StarCaster
has its own Loop Queue (`901418546619`); WaveCenter work never goes there, and
StarCaster work never comes here.

- The process is the spec → build → review loop: `docs/LOOP_ENGINEERING.md`.
  The three skills are `loop-spec`, `loop-build` and `loop-review` in
  `.claude/skills/`.
- Every ClickUp touch goes through `npm run clickup -- <command>` (Doppler
  supplies the token). Never the claude.ai connector, unless the script is
  broken, and then say so.
- When a plan produces more than one shippable unit, file each as a ticket in
  the shape `loop-spec` prescribes **before** building, even when Dane only
  asked for a plan. Work that lives only in a session is invisible to him.
- A pull request's title is the ticket's name, byte for byte, and its body
  carries the ticket link. `npm run verify` is the definition of done; CI
  runs it on every pull request.
- Two statuses are Dane's: `Needs your input` and `Ready to launch`. Only
  `ask` may set them, and no loop ever takes a ticket back out of them.

## Engineering rules (each one learned from a StarCaster outage)

1. **`main` never deploys unchecked.** Work on branches. A change reaches
   production only after the build passes in CI.
2. **Every new database table turns on row-level security when it is
   created.** Never as a later retrofit.
3. **Secret keys never reach the browser.** The Supabase service key stays on
   the server.
4. **Vercel bakes environment variables in at build time.** Changing one in
   the dashboard does nothing until a redeploy.
5. **Never write files on Vercel at runtime.** Its disk is read-only and the
   writes vanish silently. Data goes in Supabase.
6. **A save that fails must say so.** Never return the caller's own input with
   a success status when the write failed.
7. **An empty screen must say why it is empty.** To Dane, "empty" and
   "broken" look the same.
8. **Generated files are never committed.** Build them from source in CI.
9. **One topic, one folder.** Two sessions in one folder overwrite each
   other's work. Use a separate git worktree per thread.

## Infrastructure

WaveCenter has its **own** Supabase project, Vercel project and Doppler
project (`wavecenter`, created 2026-10-11; its `dev` config holds the ClickUp
token as a reference to StarCaster's, so there is one token to rotate), kept
separate from StarCaster so a failure in one cannot take down
the other. (StarCaster's shared database disk filled up on 2026-08-17 and took
every client site down with it.)
