---
name: loop-handoff
description: Hand the next task a WaveCenter member ticked for AI agents to the WaveCenter "Loop Queue" as a Queued ticket with a proper spec, highest priority first then oldest first, and bring finished tickets back to their tasks (Live → done; Live with wont-do or deferred → back to todo with a note). One hand-off per pass. Runs on the Mac Mini as the third lane next to loop-build and loop-review. Never builds, never merges.
---

# Loop: Hand-off

The lane that connects WaveCenter to the Loop Queue. Dane ticks tasks on his
to-do list and turns on **Launch AI Agents**; each pass of this lane turns the
first ticked task into a Loop Queue ticket, so the ordinary spec → build →
review → merge pipeline does the work, and nothing ships without review and
his written `merge`. See `docs/LOOP_ENGINEERING.md`, "The hand-off lane".

Dane's words (2026-10-12): "If I turn on the Launch AI Agents toggle, they will
begin working on tasks in priority, then chronological order." He chose the
same day to route the work through the Loop Queue rather than straight from
WaveCenter.

## The commands

Every ClickUp and database touch goes through `npm run clickup -- <command>`.
Doppler supplies the ClickUp token and the Supabase service key; you never see
or handle either.

```bash
npm run clickup -- handoff-sync                                 # finished tickets back to their tasks
npm run clickup -- handoff-next                                 # the next task, as JSON (exit 3: none, and why)
npm run clickup -- task --name "..." --status Queued --priority <p> --tags from-wavecenter --body-file - --id-out <file>
npm run clickup -- ask --task <ticket> --status "Needs your input" --body-file -
npm run clickup -- handoff-record --task <wavecenter-id> --ticket <ticket-id>
```

`handoff-record` changes the task through core as the tool `loop-handoff`:
the task becomes "doing" and shows **With AI agents** and the ticket link on
Dane's screen. It reads the ticket back first and refuses unless the ticket is
in the Loop Queue, tagged `from-wavecenter`, and carries the task's line. It
only lands if the task still has no ticket.

## One pass

1. **Sync back.** `npm run clickup -- handoff-sync`. It marks a task done when
   its ticket went Live, and puts it back to todo, unticked, with a note, when
   the ticket went Live tagged `wont-do` or `deferred`. Paste its last line
   into your report. A failure on one task leaves that task as it was; say
   which, and carry on.

2. **Find the next task.** `npm run clickup -- handoff-next`.
   - Exit **3**: nothing to hand over (the switch is off for everyone, or no
     ticked task is waiting). Report the reason it printed and **stop**. With
     the switch off, no new ticket is ever filed; tickets already filed carry
     on through the pipeline as normal.
   - Exit **1**: it could not read the database. Report the error and stop.
   - Exit **0**: stdout is the task as JSON: `id`, `title`, `notes`,
     `priority`, `ticketPriority`, `createdAt`, `taskLine`, `tag`.

3. **Write the spec.** Read `.claude/skills/loop-spec/SKILL.md` for the shape
   (Goal, Scope, Non-goals, Affected files / artifacts, Acceptance criteria,
   How to test, Risk) and follow it. Build it from the task's title and notes,
   and **read the code** so every file path you name is real. Do not invent
   requirements the title and notes do not support.
   - The **name** says in plain words what Dane will be able to do, or what
     breaks and who feels it, as loop-spec requires.
   - Start the body with a `## From WaveCenter` section: the task's title and
     notes **verbatim** inside a fenced block (never a `> ` blockquote;
     ClickUp deletes those), then the `taskLine` value from the JSON on a line
     of its own, exactly as printed (`WaveCenter task: <id>`).
   - **Too thin to spec without guessing?** (For example "Add the logo" with
     no logo file, or a title that could mean two different features.) Still
     write the best spec the words support, mark the gap in it, and go on: you
     will ask Dane in step 6.

4. **File it.** Write the body to a temp file, then:

   ```bash
   npm run clickup -- task --name "<name>" --status Queued --priority <ticketPriority> \
     --tags from-wavecenter --body-file <body-file> --id-out <id-file>
   ```

   Use `ticketPriority` from the JSON, never your own judgement. When it is
   `urgent`, add `--operator-asked`: `handoff-next` only says urgent when the
   member set Urgent on their own screen.

   If it exits non-zero **before** printing `Created task`, nothing was filed:
   report the error and stop. The task is untouched and the next pass tries
   again. If it printed `Created task <id>` and then a check failed (tags or
   status did not stick), fix that one thing with `tag` or `status`, then
   carry on; if you cannot, close the ticket (step 7) and stop.

5. **Record it on the task.**
   `npm run clickup -- handoff-record --task <id> --ticket <ticket-id>`.
   - Exit **0**: done. The task is now with the agents.
   - Exit **3**: the task already had a ticket (another pass got there first).
     Yours is a duplicate: close it (step 7).
   - Exit **1**: not recorded, and the task was left as it was. Run it once
     more. If it fails again, close the ticket (step 7) so nothing is built
     that the task does not know about, and report why.

6. **Ask, if the task was too thin.** Only after it is recorded, so the
   task always knows its ticket. One `ask` on the new ticket, a decision
   that is genuinely Dane's:

   ```
   @@ASKED
   <the task's title, and its notes if any, verbatim>
   @@CONTEXT
   <50-100 words: this came from your WaveCenter list, what the spec assumes, and what is missing>
   @@NEEDED
   <the one specific question, with named options where you can>
   ```

   ```bash
   npm run clickup -- ask --task <ticket-id> --status "Needs your input" --body-file -
   ```

   If the `ask` fails, retry once; if it still fails, say so in your report.
   The ticket stays Queued with the gap marked in its spec, and loop-build
   asks before building a spec too vague to build.

7. **Closing a ticket that must not be built** (only the ones you filed this
   pass): `tag --add wont-do`, a `comment` saying in one plain sentence why,
   then `status --status Live`. `handoff-sync` ignores tickets no task points
   to, so this never touches the task.

8. **Report** in plain words: the sync line, then the name of the ticket you
   filed and its link (or why none was filed). Then stop. **One hand-off per
   pass**, even if more are waiting: it limits how far a mistake can spread.

## Guardrails

- **Never build, never merge, never change code.** This lane only files
  tickets and records them. The build, review and merge lanes do the rest.
- **Never set `Ready to launch`.** `Needs your input` only through `ask`, and
  only on a ticket you filed this pass.
- **Never change a WaveCenter task any other way.** `handoff-record` and
  `handoff-sync` are the only writers, and both go through core.
- **Never touch a ticket you did not file this pass**, except through
  `handoff-sync`, which only reads tickets.
- The Supabase service key stays on the Mini, under Doppler. Never print it,
  never copy it into a file, never put it anywhere `app/` or a browser can
  read.
