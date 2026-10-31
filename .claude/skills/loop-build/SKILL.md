---
name: loop-build
description: Pick the next claimable task (all "Rework" first, then a "Ready to launch" ticket whose approved PR conflicts with main — settled in place, status untouched — then "Queued") from the WaveCenter "Loop Queue" ClickUp list and build it end-to-end into a pull request — in its own git worktree, passing `npm run verify` — then move the task to "In review". Designed to be run on a timer with `/loop 15m loop-build`. Never edits main, never merges.
---

# Loop: Build

Step 2 of 3 in the WaveCenter development loop (spec → build → review).
See `docs/LOOP_ENGINEERING.md` for the whole system.

Each run builds **one** task into **one** PR. Under `/loop` it repeats,
draining the queue one clean PR at a time.

## Before anything: one claimant

Claiming a ticket is check-then-act (a read, a comparison, a write), which is
only sound with exactly one build loop running. WaveCenter has no scheduled
runner yet, so the rule is simple: **do not start this loop if another session
is already running it.** If `queue --claimable` shows a ticket in `Building`
that is not yours, a pass is already in flight — stop and say so.

## ClickUp access: the direct script, not the connector

Every ClickUp touch goes through **`npm run clickup -- <command>`** — a full
standalone command each time (shell state does not survive between tool
calls). Doppler supplies the token; you never see or handle it. The moves this
loop makes:

```bash
npm run clickup -- queue --claimable                                   # FIRST LINE is the task to claim (all Rework, then Queued)
npm run clickup -- claim --task <id>                                   # safe claim; exit 3 = someone beat you, take the next
npm run clickup -- get --task <id>                                     # header + body; also shows any recorded PR and send-back rounds
npm run clickup -- comments --task <id>                                # the review notes live here on a Rework ticket
npm run clickup -- pr-opened --task <id> --pr <pr-url>                 # record the PR — REQUIRED, and it verifies itself
npm run clickup -- status --task <id> --status "In review"             # hand off (assignees auto-cleared)
npm run clickup -- ask --task <id> --status "Needs your input" --body-file -   # escalate: card + status together
npm run clickup -- comment --task <id> --body-file -                   # a plain note
npm run clickup -- waiting [--task <id>]                               # read-only: is this ACTUALLY waiting on Dane?
npm run clickup -- describe --task <id> --body-file -                  # REPLACE the description (left column)
```

**`describe` REPLACES the description.** The spec and acceptance criteria live
there; an outcome report is a `comment`, never a `describe`.

**Escalating is one command, not two.** `status --status "Needs your input"`
refuses on its own. Use `ask`, whose body is the operator card:

```
@@ASKED     his own words that caused this ticket, verbatim — never invented
@@WHEN      optional — when and where he said it
@@CONTEXT   the problem and the fix in plain English, 50-100 words (enforced)
@@NEEDED    the specific ask; give him named options where you can
@@EVIDENCE  required ONLY when the ask costs money or cannot be undone
```

**Hand-offs that are genuinely his** (CLAUDE.md names four): a real secret
value, a billing screen, a browser login, or a decision only he can make.
Each of those is an `ask`, saying which of the four it is. Anything else, you
run yourself.

## Never say something is waiting on Dane without checking

```bash
npm run clickup -- waiting --task <id>
```

Exit **0** nothing of his / **3** something IS his / **1** could not tell.

## Workflow

1. **Claim the next task.**

   ```bash
   npm run clickup -- queue --claimable
   npm run clickup -- claim --task <id>
   ```

   `--claimable` returns every `Rework` ticket, then every `Ready to launch`
   ticket whose approved PR has a conflict to settle, then `Queued` —
   rework oldest-first, conflicts oldest-first, queued by
   priority-then-oldest. **If the first line is `ready to launch`, do NOT
   `claim` it** (claim refuses it anyway): follow "Settling a conflict on an
   approved PR" below instead, and that is the whole pass. A `Rework` ticket
   is a send-back: it already has a branch, an open PR and review notes.
   Finishing one is cheaper than starting something new. If the list comes
   back empty, report "queue empty" and stop — do not invent work.

   `claim` reads the ticket's own status and guards the write on it. Exit 3
   means it moved underneath you — take the next task.

   **On a `Rework` ticket, do NOT start a second branch.** `get` prints the
   recorded PR. Check out that branch into a worktree
   (`git worktree add .claude/worktrees/<slug> -b <branch> origin/<branch>`),
   read the send-back in `comments`, fix what it named, and push to the SAME
   PR.

   The seven statuses are `Rework → Queued → Building → In review →
   Needs your input / Ready to launch → Live`. Two belong to Dane and no loop
   may set or clear them except through `ask`. **Assignment is the handoff
   signal**: moving into his statuses assigns him; moving into a machine
   status clears assignees. `status` enforces both and verifies they stuck.

2. **Get an isolated workspace — MANDATORY.** One worktree and one branch per
   task, off the latest `main`. Never build in the main folder; never edit
   `main` (a hook blocks it). Run this as ONE command:

   ```bash
   MAIN="$(git rev-parse --path-format=absolute --git-common-dir | sed 's#/\.git$##')" && \
     git -C "$MAIN" fetch origin --quiet && \
     git -C "$MAIN" worktree add "$MAIN/.claude/worktrees/<task-slug>" -b <task-slug> origin/main && \
     cd "$MAIN/.claude/worktrees/<task-slug>" && \
     if [ -f package-lock.json ]; then npm ci; fi
   ```

   `<task-slug>` = short kebab-case name from the task. Do ALL work for this
   task inside that worktree.

3. **Build to the acceptance criteria.** Implement exactly what the task's
   Scope and Acceptance criteria describe. Respect the Non-goals. Keep every
   rule in `CLAUDE.md` → "Engineering rules": a new table turns on row-level
   security when it is created; no secret reaches the browser; never write
   files at runtime on Vercel; a failed save says so; an empty screen says why.
   Keep room for the roadmap: a task record carries an owner, a status, a
   parent task and a points value.

   **Verify the premise before building it.** A defect ticket is a claim to
   check, not a spec to obey. If the premise is wrong, post the correction on
   the ticket FIRST (a `comment`), then build what is true.

4. **Run the gates — the definition of done.**

   ```bash
   npm run verify
   ```

   `verify` is the ONE name for the gates; CI runs the same script. If your
   task adds a new kind of check (typecheck, build, a test suite), add it to
   `verify` in `package.json` so every later task inherits it. If a gate fails
   and you cannot fix it **within the task's scope**, `ask` and stop. Do not
   force a broken build through, and do not widen scope to chase an unrelated
   failure.

   If the change has a visible surface, open it (the `run` skill, or
   `npm run dev` once it exists) and walk the ticket's "How to test" steps
   yourself. Say in the PR where you looked and what you saw.

   **Never apply a migration to the live database.** Not to test it, not
   "just this once". On 2026-10-29 a build applied PR #44's migration to live
   before Dane's `merge`, and the live member list failed for five minutes. A
   change to `supabase/migrations/` is tested only on the private test
   database: `npm run db:test` (Docker on the Mac Mini) rebuilds it from every
   migration in your worktree and runs `check_tasks_rls` there. The merge lane
   applies it to live, on Dane's `merge`. The PR's description says
   "Database: tested on the test database (`npm run db:test`)", or, on a
   machine without Docker, says it was not tested and why. Never run
   `npm run check:tasks-rls` or `supabase db push` with the live keys to test
   an unmerged migration.

5. **Add a plain-English work-log entry.** Prepend one dated entry to
   `docs/WORK-LOG.md` (newest first): what changed and why it mattered, the
   way you would explain it to a non-programmer, plus the `(#PR)` number. This
   entry rides in the task's own PR, so the log lands on `main` with the work.
   Never edit `docs/WORK-LOG.md` directly on `main`.

   You do not have the PR number yet. **Never amend a pushed commit to add
   it** — that needs a force-push, which is forbidden. Either commit the code,
   push, open the PR, then add the work-log entry as a second commit; or open
   the PR as a draft first, read the number, then write the entry.

6. **Commit and open the PR.**
   - Inspect `git diff --cached` before committing: no stray edits, no
     generated files, no `.env`. **This repository is public.**
   - Commit message ends with the Co-Authored-By trailer.
   - **The PR title is the ClickUp task name, copied exactly**
     (`npm run clickup -- task-name --task <id>` prints it). Dane pairs the
     ClickUp Closed list against the deploy list by name.
   - Push the branch and open a PR to `main` with `gh pr create`. The body
     must include **the ClickUp task URL** (`https://app.clickup.com/t/<id>`,
     on a line of its own — `pr-opened` refuses without it), a plain-language
     summary, and the task's "How to test" steps. End with the Generated-with
     trailer.
   - Wait for the `verify` check: `gh pr checks <pr> --watch`. If no check
     appears after a couple of minutes, `gh pr view <pr> --json
     mergeable,mergeStateStatus`: `CONFLICTING` means merge `origin/main` in
     (`git merge origin/main --no-edit && git push`); only on `MERGEABLE` is
     an empty nudge commit the right move.
   - **Only ordinary pushes.** If a push is rejected because the branch is
     behind, merge `origin/main` in — never rebase-and-force.

7. **Record the PR on the ticket — with the command, and check what it says.**

   ```bash
   npm run clickup -- pr-opened --task <id> --pr <pr-url>
   ```

   It refuses if the PR body has no link back to the ticket, posts the one
   line the review and merge steps read (`PR opened: <url>`), and parses it
   back. **A non-zero exit fails the run** — do not hand the ticket to review.

8. **Hand off to review.** `npm run clickup -- status --task <id> --status
   "In review"`. Leave it unassigned (it is the machine's turn). **Do NOT
   merge** — merges happen only on Dane's explicit say-so. `loop-review` takes
   it from here.

9. **Report** which task you built and the PR number, then finish.

## Settling a conflict on an approved PR

Dane wrote `merge`, but the merge lane refused with `MERGE NOT DONE (…
reason conflict)` or `reason catch-up-failed`: the branch clashes with
`main`. He does nothing here; this pass settles it **in place**.

1. `npm run clickup -- settle --task <id>` — exit 0 prints the PR and its
   branch; exit 3 means it is not owed a fix (take the next line).
2. Check the branch out into a worktree (as for Rework:
   `git worktree add .claude/worktrees/<slug> -b <branch> origin/<branch>`,
   or reuse one that is still there), then `git merge origin/main --no-edit`.
3. Settle each conflict **keeping both sides**: both changes were meant to
   ship. Read what each side was for (the two PRs / tickets) before you edit.
4. `npm run verify`, then commit the merge and push — an ordinary push,
   never a force-push, never a rebase.
5. `npm run clickup -- settled --task <id> --body-file -` with a plain note:
   which files conflicted and how both sides were kept. It refuses unless
   GitHub reads the PR `MERGEABLE`.

**Never change the status** — `Ready to launch` is Dane's, and his `merge`
still stands; the merge lane merges once `verify` is green. **Never merge the
PR yourself.**

If the two sides changed **the same behaviour** and keeping both is not
possible without a real choice, do not guess and do not push a half-merge
(`git merge --abort`). Post a card instead — it assigns Dane and leaves the
status alone, and the build loop will not pick the ticket again for this
`merge`:

```bash
npm run clickup -- settle-blocked --task <id> --body-file -   # @@ASKED / @@CONTEXT / @@NEEDED, a decision only he can make
```

Name the two behaviours as options in `@@NEEDED`, and end `@@NEEDED` with
this exact line (`settle-blocked` refuses a card without it):

```
Reply with your choice, then write merge as its own comment.
```

His plain answer is not a merge phrase, so on its own it lapses his `merge`
and nothing acts. When he answers and writes `merge` again, the lane refuses
afresh and the next pass settles it his way: read his answer in `comments`
and keep the side he chose.

## Guardrails

- **A PASS MAY NOT END WITH ITS TICKET STILL IN `Building`.** `Building` is a
  status no loop claims from, so a ticket left there is unreachable, not late.
  Before you report, the ticket is in `In review` (finished), `Rework` or
  `Queued` (handed back on purpose, with a comment saying why), or
  `Needs your input` (escalated with `ask`).
- **YOU CANNOT PROMISE TO COME BACK.** A pass ends when it stops producing
  output. If you are waiting on checks, wait inside the pass, then move the
  ticket. If you cannot wait, hand it back to `Rework` with an honest note.
- **One task, one worktree, one PR.** Never build two tasks in one branch.
- **The PR and the ticket must name each other.** `pr-opened` enforces both
  directions.
- **Never touch a task that is not `Rework` or `Queued`**, except a
  `Ready to launch` ticket `settle` says is owed a conflict fix, and then
  only its branch, never its status. `claim` refuses the rest.
- **Never set `Ready to launch` and never clear `Needs your input`.** Those
  are Dane's. A build loop never sets either one and never merges.
- If the task description is too vague to build safely, `ask` for a
  `loop-spec` pass — don't guess. Name in `@@NEEDED` what is missing.
- **If a task is bigger or riskier than one unattended pass should build**,
  `ask` before building and offer named slices, smallest-and-safest first.
  Then build only the slice he names, narrowing the description with
  `describe` first.
- **Ticket titles say in plain words what breaks and who feels it.** Fix a
  cryptic name on the ticket first, then copy it to the PR.
- Leave the worktree in place until the PR merges; `loop-review` may reuse it.
