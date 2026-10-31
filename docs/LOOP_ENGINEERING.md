# Loop Engineering on WaveCenter

How WaveCenter is built: a **spec → build → review** loop, the same process
StarCaster runs, pointed at WaveCenter's own ClickUp queue. Dane specs work in
plain language; agent sessions build it into pull requests and independently
review them; Dane writes `merge` on the ticket and a lane carries it out.
Nothing reaches `main` without a passing CI check and his written word.

This is the seed version. StarCaster grew a bus relay, auto-merge lanes,
pacing curves and a heartbeat over three months of incidents; WaveCenter
starts with the parts that were right from day one and adds the rest only
when a real cost shows up. The first such cost: on 2026-10-11 three written
`merge`s sat unread for up to three hours, so the merge lane came over. Where a rule here was learned on StarCaster, its
guide (`~/WebApps/starcaster/docs/LOOP_ENGINEERING.md`) has the incident.

## The three steps

| Step | Skill | Who runs it | What it does |
|---|---|---|---|
| 1 | `loop-spec` | a session, with Dane | interviews him, files small tasks with acceptance criteria and test steps |
| 2 | `loop-build` | a loop | claims the next task, builds it in its own worktree, passes `npm run verify`, opens a PR, hands it to review |
| 3 | `loop-review` | a loop | independently re-verifies the PR, then hands it to Dane (`Ready to launch`) or back to build (`Rework`) |

The skills live in `.claude/skills/`; Claude Code discovers them nowhere else.

## ClickUp access — the ids, written down once

Every ClickUp touch goes through **`npm run clickup -- <command>`**
(`scripts/clickup.mjs`, wrapped in Doppler by `package.json`, so the token is
supplied without any agent or human handling it). The claude.ai connector's
shared budget starves under loop traffic; ClickUp's own API allows about 100
requests a minute. Use the connector only when the script itself is broken,
and say so.

| Thing | Id |
|---|---|
| Workspace ("Alphire AI Agency") | `90141423066` |
| WaveCenter **space** | `90146476554` |
| **Loop Queue list** (WaveCenter) | `901422159126` |
| Dane's inbox — his **developer** seat, dane@alphire.agency | `48012725` |
| The machine — **Pulse** / mentor24, holds the token; **never assign it** | `54254347` |
| StarCaster's Loop Queue — a different project; **never file WaveCenter work there** | `901418546619` |

**Id trap:** a space id where a list id belongs earns ClickUp's misleading
"Team not authorized" 401. `npm run clickup -- lists` resolves list ids by
name.

**Whose seat the token is.** Dane is two members of this workspace: his own
developer seat (`48012725`) and Pulse, the workspace's service account
(`54254347`). The API token in Doppler acts as **his own seat** — `npm run
clickup -- whoami` says "Acting as: Dane" — exactly as StarCaster's does. So
every comment the script posts ends with a `[machine]` marker line, stamped
at the one place comments are sent, and every reader that asks "did Dane
speak last?" skips stamped comments. Never assign Pulse.

The everyday commands (`npm run clickup` bare prints the full list):

```bash
npm run clickup -- whoami                                       # proves the token works; says who it acts as
npm run clickup -- queue --claimable                            # first line = the task loop-build should claim
npm run clickup -- queue --status "In review"                   # first line = the task loop-review should take
npm run clickup -- get --task <id>                              # header + body, recorded PR, send-back count
npm run clickup -- comments --task <id>                         # the comments, oldest first, Mountain time
npm run clickup -- waiting [--task <id>]                        # is this ACTUALLY waiting on Dane? exit 0 no / 3 yes
npm run clickup -- task --name "..." --status Queued --priority high --tags epic --body-file -   # file a ticket
npm run clickup -- claim --task <id>                            # loop-build's atomic claim
npm run clickup -- status --task <id> --status "In review"      # a machine-status move; assignees auto-cleared
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -   # hand it to Dane: card + status + assignment
npm run clickup -- pr-opened --task <id> --pr <pr-url>          # record the PR (required; verifies both directions)
npm run clickup -- verdict --task <id> --pass|--fail --if-status "In review" --body-file -   # the review verdict
npm run clickup -- describe --task <id> --body-file -           # REPLACE the description (left column)
npm run clickup -- comment --task <id> --body-file -            # a plain note
npm run clickup -- tag --task <id> --add wont-do                # kill or park (see below)
```

Every write reads itself back. A 200 from ClickUp proves a request landed,
not that the right thing did: statuses are per-list (a bare PUT returns 200
for a status the list does not have), descriptions can save empty, and
ClickUp **deletes `> ` blockquote lines** from comments and descriptions
without saying so. The script refuses a blockquote before sending.

## The seven statuses — and the two that are yours

| Status | What it means | Whose move |
|---|---|---|
| `Rework` | review sent it back — a branch and a PR already exist | machine |
| `Queued` | waiting for a build loop to pick it up | machine |
| `Building` | a loop is writing the code | machine |
| `In review` | a loop is checking that code against the task | machine |
| **`Needs your input`** | stuck — a question or decision only you can settle | **yours** |
| **`Ready to launch`** | built and independently verified, waiting for your go | **yours** |
| `Live` | merged and shipped — closed, out of your open view | — |

The two human statuses ask different things. `Needs your input` wants an
**answer**: a loop stopped and wrote you a plain-language question. `Ready to
launch` wants a **yes**: nothing is wrong, it is finished and waiting on the
merge only you authorize. On a normal day you can ignore the other five.

**`Rework` exists** so a half-built ticket is never mistaken for one nobody
has started. loop-build drains every `Rework` ticket before any `Queued` one,
oldest first, priority ignored: priority says what to *start*; rework is not
started, it is finished. Between the two it takes any `Ready to launch`
ticket whose approved PR the merge lane could not merge because of a
conflict (see "When the PR conflicts with main" below), without moving it.

Two rules keep it honest:

- **Nothing puts a ticket into `Live` but a merge**, and only you authorize a
  merge: by writing `merge` on the ticket (see "The merge lane" below).
- **No build or review loop ever takes a ticket out of `Needs your input` or
  `Ready to launch`.** Once handed to you it stays yours until you act. Your
  own comment is the act: the merge lane carries out a `merge` on `Ready to
  launch`, and moves a `Needs your input` ticket back to `Queued` once your
  plain answer is the newest comment on it, so you never have to drag it.

`Live` is a **closed**-type status in ClickUp. That is what makes finished
work disappear from the open view. The click-by-click setup of this status
set is `docs/CLICKUP_SETUP.md`.

### Assignment is the handoff

Your "what needs me" is ClickUp's own **Assigned to me**, which spans every
space. Loops assign you when a ticket enters one of your two statuses and
clear assignees when it returns to a machine status; the `status` command
enforces both and verifies they stuck. A ticket in a machine status with you
still assigned is a bug.

### The operator card

Anything a loop puts in front of you arrives as one comment in a fixed shape,
posted by `ask` together with the status move so the two can never come apart:
your own words that caused the ticket (in a fence, verbatim), what's going on
in 50-100 plain words, and the ask under a red **NEEDED FROM DANE:** banner,
last on the card. An ask that spends money or cannot be undone must carry the
command that proves it, its real output, and when it was run.

Detail goes in the **description** (left, wide); the card is the only thing in
the **comments** (right, narrow).

### Killing and parking a ticket

There is no `Won't do` status. A ticket you decide against closes as `Live`
plus the **`wont-do`** tag and a comment saying nothing shipped. A ticket that
is real but not worth a queue slot right now closes as `Live` plus the
**`deferred`** tag, keeping its description and comments; reviving it is
setting the status back to `Queued`.

### Titles

A ticket's name says in plain words **what breaks and who feels it**, or what
you will be able to do once it ships. The diagnostic sentence goes in the
description.

## The two traces a ticket must carry

- **`PR opened: <url>`** — written by `pr-opened`, which first checks that the
  PR body links back to the ticket, then reads its own comment back with the
  same parser the review step uses.
- **`REVIEW: PASSED — …`** or **`REVIEW: sent back to Rework — …`** — written
  by `verdict`. `Ready to launch` is refused unless the newest verdict is a
  PASS, from both doors (`ask` and `status --no-card`).

A send-back counts its round. **The fourth is refused**: three send-backs
mean the spec was wrong, not the build, and the ticket goes to you with the
three reasons listed and named options (respec / split / drop).

## How to run it

**They run on the Mac Mini.** Since 2026-10-11 both lanes run unattended on
the Mac Mini (account `daneofearth`, checkout `~/WebApps/wavecenter`) as
launchd agents, `com.wavecenter.loop-build` and `com.wavecenter.loop-review`,
beside StarCaster's. Each keeps the committed `scripts/loop_runner.sh` alive
across crashes and reboots; each pass is a fresh headless Claude Code session
that pulls `main`, runs one skill, and sleeps 15 minutes. A pass has a
two-hour time limit (the hand-off lane's is 15 minutes; see below). Nobody starts a loop by hand while those are loaded: a
second claimant makes the check-then-act claim unsound.

So the question is never "shall I start one", it is "what is it doing":

```bash
ssh mac-mini 'cd ~/WebApps/wavecenter && ./scripts/install_loop_runner.sh --status'   # installed? alive? lock? last pass?
ssh mac-mini 'tail -40 ~/loop-logs/wavecenter-loop-build.log'                          # what the last build pass said
ssh mac-mini 'tail -40 ~/loop-logs/wavecenter-loop-review.log'
```

Three things the log can say that need a person:

- **"THIS PASS COULD NOT SIGN IN TO CLAUDE."** The Mini's Claude sign-in
  expired. Only Dane can sign in, at the Mini's own screen or Screen Sharing
  (an ssh sign-in does not reach launchd). Then restart the jobs:
  `launchctl kickstart -k gui/$(id -u)/com.wavecenter.loop-build` and the same
  for `loop-review`.
- **"hit the time limit"** twice on one ticket: a gate that will not go green.
  Read the ticket and hand it back or `ask`.
- **Nothing written for hours** while the queue has work: `--status` says
  whether the runner is alive. A stale lock clears itself on the next start.

### The merge lane

A third launchd agent, `com.wavecenter.merge-on-comment`, runs
`scripts/merge_lane.sh` every **10 minutes** (StarCaster's interval for the
same lane: a `merge` is the one thing you wait on with the app open). It is a
plain `node` script under Doppler (`npm run clickup -- merge-on-comment`), not
a Claude session, so it costs no model usage. Its log is
`~/loop-logs/wavecenter-merge-on-comment.log`.

**What counts as your `merge`.** On a `Ready to launch` ticket, your newest
own comment (your user id, without the `[machine]` stamp the loops put on
theirs) must be, **as the whole message**, one of: `merge`, `merge it`,
`ship it`, `approve`. Case and a trailing `!` or `.` do not matter, and the
code fence or bold ClickUp adds to a pasted word is stripped first. "do not
merge this yet" is not a merge. A later plain comment from you ("wait")
cancels it. It must also be newer than the newest review PASS: a `merge`
written for an earlier round does not release a rebuilt PR. The rules are
`scripts/lib/mergeWords.mjs`, every one of them a test.

**What it does with it**, in this order: reads the recorded PR from GitHub;
if `main` has moved on, merges `main` into the branch and waits for `verify`
to pass again on the combined code; when the PR is open, conflict-free and
`verify` is green, squash-merges it and deletes the branch; reads GitHub back
until it says MERGED; only then comments the merge commit on the ticket and
sets it `Live`. A PR you merged by hand gets one truthful comment and `Live`.

**Database changes go live here, and only here.** When the PR adds a file to
`supabase/migrations/`, the lane applies it to the live database from the
exact commit it is about to merge, just **before** the squash-merge, then reads
the database's own migration list back. The merge comment ends with a
`Database:` line saying what was applied. If the apply fails, the PR is **not**
merged, the live database is as it was (each migration file is
all-or-nothing), and the ticket stays in `Ready to launch` with a
`MERGE NOT DONE (… reason migration-failed)` note. Before your `merge`,
migrations are only ever tested on the private test database
(`npm run db:test`, see `docs/INFRASTRUCTURE.md`): on 2026-10-29 a build
applied one to live early and the member list failed for five minutes.

**When it will not merge** (a red check, a conflict, no check at all), it
posts **one** comment saying exactly why and what has to happen, and does not
repeat it. Your `merge` still stands: every pass checks again and merges the
moment the reason is gone.

**When the PR conflicts with main** (reason `conflict`, or `catch-up-failed`
when GitHub could not merge `main` in by itself), you have nothing to do.
On 2026-10-12 a PR sat twelve hours after your `merge` because the note
asked you to move the ticket. Now the next build pass takes the ticket where
it stands: merges `main` into the branch, keeps both sides, runs `verify`,
pushes, and posts `CONFLICT SETTLED` saying what conflicted. It never
changes the status, so your `merge` still stands and this lane merges once
`verify` is green on the combined code. If the two sides changed the same
behaviour and a real choice is needed, it posts `CONFLICT NOT SETTLED` with
a question for you instead of guessing; the card ends by asking you to
reply with your choice and then write `merge` again, because your answer
alone does not count as a merge. (`npm run clickup -- settle`,
`settled` and `settle-blocked`; the rules are `conflictToSettle` in
`scripts/lib/mergeWords.mjs`.)

**Answers.** On a `Needs your input` ticket, when your plain answer is the
newest comment, the same pass comments "Dane answered; back in the queue" and
moves it to `Queued`, so the build loop reads your answer on its next pass.

```bash
ssh mac-mini 'tail -30 ~/loop-logs/wavecenter-merge-on-comment.log'     # what the last merge pass did
npm run clickup -- merge-on-comment --dry-run                            # what it WOULD do now, writing nothing
```

### The hand-off lane

A fourth launchd agent, `com.wavecenter.loop-handoff`, is how the tasks you
tick on your WaveCenter to-do list reach the agents. It runs the
`loop-handoff` skill (`.claude/skills/loop-handoff/SKILL.md`) every 10
minutes, through the same `scripts/loop_runner.sh` as build and review. Your
words (2026-10-12): "If I turn on the Launch AI Agents toggle, they will begin
working on tasks in priority, then chronological order." You chose the same
day to route that work through this Loop Queue, so nothing ships without
review and your written `merge`.

Each pass does two things:

1. **Sync back.** Every task already handed off is checked against its
   ticket. A ticket that went `Live` marks its task done. One closed `Live`
   with the `wont-do` or `deferred` tag puts its task back to todo, unticked,
   with a note on the task saying why. Anything else is still being worked.
2. **At most one hand-off.** If your "Launch AI Agents" switch is on, the
   first ticked task in line (Urgent, High, Normal, Low, then oldest first:
   `agentOrder` in `core/agents.ts`) becomes a Queued ticket here, tagged
   `from-wavecenter`, with a spec in the `loop-spec` shape written from its
   title and notes and the line `WaveCenter task: <id>`. Its priority is the
   task's own; Urgent only carries over when you set it yourself. If the
   title is too thin to build without guessing, the ticket is still filed and
   you get one question on it in `Needs your input`. The task then shows
   **With AI agents** and a link to its ticket.

Turning the switch off stops new hand-offs. Tickets already filed carry on.

**A task the lane gets stuck on is skipped, not waited on.** On 2026-10-30
three passes in a row froze on the same first task, and the ten tasks behind
it waited about five hours. Now each pass's `handoff-next --take` writes down
which task it took, in `~/loop-logs/wavecenter-handoff-takes.json` on the
Mini. Once two passes have taken a task and neither recorded a ticket, later
passes skip it and take the next one in line. Every skip is named by its
title, in the pass report and in the lane log
(`~/loop-logs/wavecenter-loop-handoff.log`, lines starting `[handoff-next]`),
so you can see which task is stuck. It stops being skipped as soon as it gets
a ticket, or you edit it, or untick and tick it again. A plain
`handoff-next` (no `--take`) only shows what the next pass would take and
never counts as a take. A hand-off pass also has a 15-minute time limit
instead of two hours (a working one takes 1 to 2 minutes), so a frozen pass
costs minutes. A running lane keeps its old limit until it is restarted:
`./scripts/install_loop_runner.sh` from the main checkout.

Safety: the lane reads every member's tasks with the Supabase service key,
which lives in Doppler on the Mini and never reaches the website or a browser.
It changes a task only through core, as the tool `loop-handoff`
(`npm run clickup -- handoff-record` and `handoff-sync`). Recording a ticket
only lands if the task has none yet, so a task is never handed off twice, and
a ticket is only recorded after it is read back from ClickUp. One hand-off per
pass limits how far a mistake can spread.

```bash
ssh mac-mini 'tail -40 ~/loop-logs/wavecenter-loop-handoff.log'   # what the last hand-off pass did
npm run clickup -- handoff-next                                     # which task is next in line, writing nothing
bash scripts/loop_runner.sh loop-handoff --once                     # one pass now, its report printed here
```

### Starting one by hand — only when the Mini's agents are unloaded

Two commands, each in **its own session**, from any folder in the repo (the
loop makes its own worktree per task):

```
/loop 15m loop-build
/loop 15m loop-review
```

### Installing or moving the runner

`./scripts/install_loop_runner.sh` on the machine that will own the loops,
from its **main checkout** (never a worktree). It installs all four lanes and
refuses if `npm`, `node`, `doppler`, `claude`, `git` or `gh` is missing, or if
`gh` is not signed in to GitHub. `--uninstall` removes all four agents. Before
installing on a second machine, uninstall on the first: two machines claiming
is the collision the lock exists to prevent.

**The checkout must sit on a clean `main`.** The runner pulls only a clean
`main`; on any other branch every pass runs that branch's code and never sees
merged work. `--status` prints a `WARNING` when this is so, and the installer
warns too. The runner was first installed from its own branch (it was not on
`main` yet), so once that pull request merges, put the Mini back:
`git -C ~/WebApps/wavecenter checkout main && git -C ~/WebApps/wavecenter pull`.

Your day:

1. **Morning:** run `loop-spec` in a session, answer its questions, approve
   the task list.
2. **During the day:** the loops build and review. Each `Ready to launch`
   ticket lands in *Assigned to me* with a preview link and test steps.
3. **When you're ready:** write **`merge`** on the ticket. Within 10 minutes
   the merge lane merges it (only with the `verify` check green) and sets the
   ticket `Live`, with a comment naming the merge commit.
4. **When a ticket asks you a question** (`Needs your input`): answer as a
   comment on the ticket. Within 10 minutes it goes back to `Queued` on its
   own.

### What the `verify` gate is

`npm run verify` is the ONE name for the definition of done. CI runs it on
every pull request; the build loop runs it before opening a PR; the review
loop runs it again. Today it parses every script and runs the unit tests. As
the app grows, each new kind of check (typecheck, build, browser test) is
added to that script, and every lane inherits it at once.

### Safety — why this is wired the way it is

- `main` is what ships. A hook refuses edits on `main`; every change is a
  branch, a PR and a green check.
- No loop merges without Dane's own written word on the ticket. `Ready to
  launch` is a request, not an action; his `merge` is the action, and the
  merge lane only carries it out with `verify` green.
- Every write to ClickUp is verified by reading it back.
- Urgent priority is yours alone; the script refuses to set it without a
  written claim that you asked.
- The repository is public. The review loop greps every diff for anything
  that looks like a key.

## The work log

`docs/WORK-LOG.md` is a plain-English record, newest first, one entry per
merged PR, written inside the PR it describes. It is for you, not for the
machine.

## Cost

A loop is an agent running continuously, so it spends tokens whether the
output is good or not. Start with one build loop on small, self-checking
work, confirm the value, then widen.

## First-time setup checklist

1. ✅ The **Loop Queue** list exists in the WaveCenter space (2026-10-11).
2. ⬜ Its statuses are the seven above, in order, with `Live` closed —
   `docs/CLICKUP_SETUP.md`, done by Dane in the ClickUp web app.
3. ✅ The three skills live in `.claude/skills/`.
4. ✅ Doppler holds the ClickUp token in `wavecenter/dev` (as a reference to
   StarCaster's, so there is one token to rotate). `npm run clickup -- whoami`
   prints "Token valid. Acting as: …".
5. ⬜ A dry run: one `loop-build` pass on the smallest ticket, then one
   `loop-review` pass, before trusting it with the rest.
6. ✅ The scheduled runner on the Mac Mini (2026-10-11).
7. ⬜ The merge lane on the Mac Mini: after its pull request merges, run
   `./scripts/install_loop_runner.sh` again from the main checkout;
   `--status` then shows three lanes.
8. ⬜ The hand-off lane on the Mac Mini: after its pull request merges, run
   `./scripts/install_loop_runner.sh` again from the main checkout;
   `--status` then shows four lanes.
