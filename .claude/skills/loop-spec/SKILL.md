---
name: loop-spec
description: Turn a rough idea from Dane into a set of small, well-scoped, independently-shippable work items filed as tickets in the WaveCenter queue in the tracker, each with acceptance criteria and test steps. This is the ONLY manual step of the loop — run it at the start of a work session to feed the build/review loops.
---

# Loop: Spec

Step 1 of 3 in WaveCenter's development loop (spec → build → review), the loop Spirality defines.
See `docs/LOOP_ENGINEERING.md` for the whole system.

Your job: interview Dane about an idea, then break it into a queue of small
tasks that the `loop-build` skill can build one pull request at a time. You do
NOT write any code here. You produce well-formed tasks.

## Inputs

- A rough idea or goal from Dane (one sentence is fine to start).
- The target is the WaveCenter queue in **the tracker** (the script's
  default; ids like `WC-12`). File tasks through the direct script, which carries
  priority and tags and verifies the body saved:

  ```bash
  npm run clickup -- task --name "..." --status Queued --priority high --tags "epic-name" --body-file -
  ```

  (body on stdin). **Never file another project's work here**, nor WaveCenter's anywhere
  else: each project's queue builds that project.

  **File at High or below.** Urgent is Dane's own lane: the queue sorts
  priority-then-age, so an Urgent flag is a human override, and that only
  works if agents never set it. `task --priority urgent` refuses unless
  `--operator-asked` is also passed, which is your written claim that he asked.

- **Files attached to a ticket.** When the idea arrives as a ticket and
  `npm run clickup -- get --task <id>` prints `attachments:` lines (anything
  but `attachments: (none)`), they are part of his idea. Save them outside
  the repository and read every one (pictures and text both; the Read tool
  opens a picture) before writing the tasks:

  ```bash
  npm run clickup -- attachments --task <id> --to /tmp/<id>-attachments
  ```

  It prints `saved <path> (<size> bytes)` per file and exits non-zero naming
  any file that did not save; a file that did not save is a failure you
  report, never one you write past. Never copy a file into the repository or
  a pull request. `attachments: COULD NOT BE READ` means the ticket's files
  are unknown: say so on the ticket and in your report, and never treat it
  as none.

## Workflow

1. **Interview until confident.** Ask Dane focused questions — a few at a
   time, plain language — until you understand the goal well enough to write
   tasks a fresh agent could build with no further context. Cover: what "done"
   looks like, which screens/files are in scope, what is explicitly NOT in
   scope, how a human would verify it. Keep asking until you could hand it to
   someone who has never seen the idea.

2. **Split into small, independent tasks.** Each task must be:
   - **One PR's worth of work** — if it needs more than a few files or touches
     unrelated systems, split it.
   - **Independent** — buildable without waiting on another task, so parallel
     work does not collide. If two tasks must touch the same file, merge them
     or state the ordering explicitly in both descriptions.
   - **Reviewable by a human in a couple of minutes.**

3. **Write each task.** `status: Queued`, **no assignee** (assignment is how
   the loops hand a ticket to Dane), and a description in exactly this shape.

   **The description is the LEFT column, and it is where the detail goes.**
   The right-hand comment column is narrow; it carries only the operator card.

   **Never use a `> ` blockquote anywhere in a ClickUp body.** ClickUp deletes
   those lines silently, from descriptions and comments alike, and the write
   still returns a clean 200. Use a fenced block. The script refuses them.

   ````
   ## Goal
   One or two sentences: what this task does about it.

   ## Scope
   - Bullet list of what this task changes.

   ## Non-goals
   - What this task must NOT touch (prevents scope creep in the build loop).

   ## Affected files / artifacts
   - Source files likely involved — real paths, checked, not guessed.

   ## Acceptance criteria
   - [ ] Concrete, checkable outcomes. The build loop is done when all are met.
   - [ ] WaveCenter's standing rules where they apply: a new table turns on
         row-level security when created; no secret reaches the browser; a
         failed save says so; an empty screen says why it is empty.

   ## How to test
   - Steps **Dane** can follow. Every step is one of exactly two things:
       1. **a link he can click**, or
       2. **an exact command to copy and paste**, with the output it should
          print written next to it.
     "Open the page in a browser" is not a step.

   ## Risk
   low | medium | high — and one line on the blast radius.
   ````

   **Ticket names** (WaveCenter's rule, CLAUDE.md): Dane's own title word for
   word when the ticket came from him, unless it is over 12 words, then
   condensed to 12 or fewer; any other name is 6-12 plain words. He scans a
   list, so a name is short and relevant; what breaks and who feels it goes in
   the Goal. Good: *"Dane cannot sign in yet: add sign-in"*. Not: *"Auth:
   wire Supabase session middleware"*. Spirality's `task` does not count the
   words, so count them yourself before filing.

   Tag each task with the epic name so the queue stays legible.

   To rewrite an existing task's description:
   `npm run clickup -- describe --task <id> --body-file -` (it REPLACES the
   whole left column and reads the result back).

4. **Every ticket starts as a WaveCenter task** (WaveCenter's own step, kept
   from its loop before the move to Spirality's). Dane, 2026-11-01, asked
   "From now on, should every change start as a WaveCenter task?": "Yes,
   always a task". So the Evolution card a change gets credits him, no ticket
   is filed with only a tracker record behind it. These two commands are
   WaveCenter's own door, `npm run wavecenter` (scripts/wavecenter_tasks.mjs),
   not Spirality's `npm run clickup`. For **each** ticket (one task per
   ticket, so each card has its own):

   1. Make his task. The title is the ticket's name; the notes are his own
      words that asked for it, verbatim. Points stay 0 unless he gave a
      number (`--points <n>`). Redirect the output to a file: zsh's `echo`
      mangles the JSON.

      ```bash
      npm run --silent wavecenter -- chat-task --title "<ticket name>" --notes-file - [--points <n>] [--priority <p>] > /tmp/<slug>-task.json
      ```

      It prints the task as JSON (`id`, `title`, `notes`, `taskLine`, `tag`).
      It is owned by Dane and starts **unticked**, so the hand-off lane never
      files it a second time. Exit 1: nothing was made; say why and stop.
   2. Start the ticket's body with a `## From WaveCenter` section: the task's
      `title` and `notes` exactly as printed, inside a fenced block, then the
      `taskLine` value on a line of its own (`WaveCenter task: <id>`). The
      spec (Goal, Scope, …) follows below it.
   3. File the ticket with `--tags from-wavecenter` added to its epic tag
      (`--tags "from-wavecenter,<epic>"`), and `--id-out <file>` to keep its
      id.
   4. Record it on the task:

      ```bash
      npm run wavecenter -- chat-record --task <wavecenter-id> --ticket <ticket-id>
      ```

      It reads the ticket back and refuses unless it is in WaveCenter's
      queue, tagged `from-wavecenter` and carries the task line; then the task
      shows **With AI agents** and the ticket link. Exit 3: the task already
      had a ticket, so yours is a duplicate: close it (`npm run clickup -- tag
      --task <id> --add wont-do`, a `comment` saying why, `status --status
      Live`). Exit 1: run it once more; if it fails again, say so in your
      report, naming the task and the ticket.

   If filing the ticket fails after the task was made, the task stays on
   Dane's list as a plain to-do, unticked; name it in your report so it is
   not a mystery.

   This covers every ticket an agent files, including a follow-up a builder
   finds on its own: it is Dane's task too. If a builder finds a reason a
   ticket should not be his, it asks him (`ask`) rather than skipping this.
   A ticket the hand-off lane files already has its task; it never comes
   through here.

5. **Report back.** List the tasks you filed (name + risk + one-line goal) and
   the total. Then say what the build loop is actually doing — **never tell
   Dane to start one without checking**. WaveCenter's lanes run on the
   Mini (`com.wavecenter.loop-build` and the rest:
   `scripts/install_loop_runner.sh --status`), so never tell him to start a
   build or review loop by hand while they are loaded, because claiming a
   ticket is check-then-act.

## Never say something is waiting on Dane without checking

```bash
npm run clickup -- waiting                    # what actually needs him
npm run clickup -- waiting --task <id>        # one ticket: status, assignee, last word, verdict
```

Read-only, exit **0** nothing of his / **3** something IS his / **1** could not
tell. A ticket he has already answered must never be handed back to him twice.

## The operator card — the only thing that goes in the right column

Anything a loop puts in front of Dane goes through **one** command, which
posts the card and moves the status together:

```bash
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -
```

```
@@ASKED
his own words that caused this ticket, verbatim — never invented
@@WHEN
2026-10-11 9:40am, in the planning session   (optional)
@@CONTEXT
The problem and the fix in plain English. 50-100 words, enforced.
@@NEEDED
The specific ask. "Nothing right now" is a good answer, but write it down.
Your move: Reply — a short reason   (Merge / Close / Reply; required, last line)
@@EVIDENCE
Only when the ask costs money or cannot be undone: the command, its ACTUAL
output in a ``` fence, and one line "@@MEASURED 8:04pm" (Mountain time).
```

`@@NEEDED` renders under a red banner, **NEEDED FROM DANE:**, last on the card.

## Evidence, or it is a question

A **defect ticket must cite its mechanism**: the file and function (or line)
of the code it claims is wrong, quoted — not the log line that prompted the
suspicion. If you cannot cite it, you have a suspicion, not a defect: file it
as a QUESTION (a ticket that asks, in its name) and let the builder's first
step be reading the code. A threshold or trade-off names its measurement, or
says plainly "not measured".

## Guardrails

- **Prefer low-risk tasks first** when ordering a new queue, so the loop earns
  trust before touching anything that holds data or keys.
- **Flag anything that can't be a clean small PR.** Propose how to slice it.
- Never file a task whose acceptance criteria you couldn't verify yourself.
- **Read your own "How to test" back as Dane.** A step he cannot act on
  without asking a follow-up question is not a test step.
- **A pipeline ticket needs a COST, not a gap.** File a ticket about the loop
  machinery itself only when a failure actually cost something observable.
  Otherwise it is one plain line in your report, not a ticket.

## First-time setup

(ClickUp projects only; the tracker carries the statuses itself, eight of
them, `Requested` first: a request Dane filed from the tracker page that
nobody has specced yet. ClickUp lists never carry `Requested`.) If a
ClickUp "Loop Queue" list does not carry the seven statuses yet,
point Dane at Spirality's [`docs/CLICKUP_SETUP.md`](https://github.com/mentor24-maker/spirality/blob/main/docs/CLICKUP_SETUP.md) — ClickUp's API cannot edit a list's
status set, so that is a click-by-click step in the ClickUp web app. The loops
key off these exact names, matched case-insensitively:
`Rework, Queued, Building, In review, Needs your input, Ready to launch, Live`.
`Live` must be a **closed**-type status.
