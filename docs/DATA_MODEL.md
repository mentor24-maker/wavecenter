# WaveCenter data model

What WaveCenter stores, in plain words. Today that is three tables: `tasks`;
`member_settings`, which holds each member's "Launch AI Agents" switch; and
`task_files`, the files attached to tasks, whose stored copies live in a
private file-storage bucket.
The exact definition is the migrations in `supabase/migrations/`
(`20261011120000_tasks.sql` made the table; `20261011200000_tasks_tool.sql`
added `tool`; `20261012180000_ai_agents.sql` added `priority`,
`agent_selected` and the `member_settings` table;
`20261012230000_agent_handoff.sql` added `agent_ticket_url`;
`20261013040000_task_files.sql` added `task_files` and the `task-files`
bucket); this page explains them.

## The `tasks` table

One row is one task: something a member means to do, is doing, or has done.

| Column | What it holds |
|---|---|
| `id` | The task's permanent, unique identifier. Made automatically. |
| `title` | What the task is, in a few words. Required, and cannot be blank. |
| `notes` | Anything longer: detail, links, thoughts. Optional. |
| `owner_id` | **The member the task belongs to.** Filled in automatically with whoever is signed in. |
| `status` | **Where the task stands:** `todo`, `doing` or `done`. Starts at `todo`. No other values are accepted. |
| `parent_task_id` | **The bigger task this one is part of**, if any. Empty for a top-level task. |
| `points` | **What the task is worth**, as a whole number. Starts at 0 and is never empty. |
| `position` | Where the task sits in its list, so members can put tasks in their own order. |
| `created_at` | When the task was made. |
| `updated_at` | When it last changed. Kept current automatically on every change. |
| `completed_at` | When it was marked `done`. Stamped automatically, and cleared if the task is reopened. |
| `priority` | **How urgent the task is:** `urgent`, `high`, `normal` or `low`, the same four ClickUp uses. Starts at `normal`. |
| `agent_selected` | **The member has ticked this task for AI agents to work on.** Starts unticked. A done task cannot be ticked, and finishing a task unticks it. |
| `agent_ticket_url` | **The Loop Queue ticket the task was handed to**, if any. Empty until the hand-off lane files it; while set, the task shows "With AI agents" and a link. Kept when the ticket goes Live and the task is done, as the record of who did it; cleared if the ticket is closed without being built, or the task is reopened. |
| `tool` | **Which tool last changed the task.** WaveCenter's own app is `wavecenter`, which is also the starting value and what every task made before this column existed got. Never blank. |

### Every change goes through core, and names its tool

No screen, script or tool writes to this table directly. They all call the
functions in `core/` (Dane's decision D on the extension model, 2026-10-11;
see `docs/EXTENSION_MODEL.md`):

- `createTask`, `updateTask` and `deleteTask` in `core/tasks.ts` are the only
  way to make, change or delete a task. A task can only be put under a parent
  the member can see (their own), and never under one of its own sub-tasks,
  so the tree cannot loop. The to-do list itself only offers one level of
  sub-tasks for now; that is a limit of the screen, not of the table.
- `setPoints` and `awardPoints` in `core/points.ts` are the only way to change
  a task's points. `updateTask` refuses to touch them. Each one reports what
  changed: the points before, after, the difference, and the tool.

Every one of these functions takes the name of the tool making the change and
refuses with a plain message if it is missing. The name is saved in `tool`, so
every record says where its last change came from. This is the first step
towards member-built tools: when they arrive, they get points the same way
WaveCenter's own app does, through core, never by editing the number.

Two changes to the same task's points at the same moment cannot quietly
cancel each other out: a points change only saves if the points are still
what it read, and otherwise says "try again" and saves nothing.

### Handing tasks to AI agents

A member ticks the tasks AI agents may work on and turns on the **Launch AI
Agents** switch. Agents take the ticked tasks highest priority first, and
within a priority the oldest first (Dane, 2026-10-12: "in priority, then
chronological order"). That order is worked out in one place,
`agentOrder` in `core/agents.ts`, so the screen and the agents can never
disagree about it.

The switch lives in `member_settings`, one row per member:

| Column | What it holds |
|---|---|
| `owner_id` | The member the settings belong to. |
| `agents_on` | **The "Launch AI Agents" switch.** Off until the member turns it on. A member with no row yet counts as off. |
| `tool` | Which tool last changed the row, as on `tasks`. |
| `updated_at` | When it last changed. Kept current automatically. |

When the switch is on, the hand-off lane on the Mac Mini (tool
`loop-handoff`; `docs/LOOP_ENGINEERING.md`, "The hand-off lane") files the
first ticked task in that order as a Loop Queue ticket and records its link
in `agent_ticket_url`, making the task `doing`. A task with a link is no
longer in line, so it is never handed off twice; the write that records the
link only lands if the task still has none. When the ticket goes Live the
task becomes `done`; when it is closed as `wont-do` or `deferred` the task
goes back to `todo`, unticked, with a note saying why. Only three functions
in `core/agents.ts` change the link: `handOffTask`, `completeHandOff` and
`returnHandOff`.

The switch only changes through `setAgentsOn` in `core/agents.ts`. Row-level
security was on from the moment this table was made: a member reads and
changes only their own row, and a signed-out visitor gets nothing.
`npm run check:tasks-rls` proves it for this table too.

### Files attached to a task

A member can attach files to a task: a logo, a screenshot, a document. Each
file has two halves. The **stored copy** sits in a private Supabase Storage
bucket called `task-files`, never on the web host's own disk (engineering
rule 5), in a folder named after its owner:
`<owner id>/<task id>/<random id>-<file name>`. The **record** is one row in
`task_files`:

| Column | What it holds |
|---|---|
| `id` | The file's permanent identifier. |
| `task_id` | The task it is attached to. If the task is deleted, the row goes with it. |
| `owner_id` | The member it belongs to. Filled in automatically. |
| `path` | Where the stored copy is. It must sit in its owner's folder for its own task. |
| `name` | The file's name as the member chose it. Never blank. |
| `content_type` | What kind of file it is, for example `image/png`. Pictures show as thumbnails. |
| `size_bytes` | How big it is. At most 10 MB; the bucket refuses anything bigger too. |
| `tool` | Which tool attached it. |
| `created_at` | When it was attached. |

Files only change through `core/files.ts`: `attachFile`, `removeFile` and
`deleteTaskWithFiles`. They keep the two halves in step. A record is only
written for a copy that is already stored, and if the record cannot be
written the copy is deleted again. Removing a file, or deleting its task,
deletes the stored copy, not just the record.

A file goes from the browser straight to storage, using a one-time upload
link the server asks for as the signed-in member. No key reaches the
browser, and a big file never passes through the web server (Vercel refuses
requests over about 4.5 MB; this way also works on any host). Viewing a file
uses a signed link that stops working after an hour; the bucket has no
public links at all.

Row-level security was on from the moment `task_files` was made, and the
bucket has its own rules: a member reads, adds and deletes only their own
files, only in their own folder, and only on their own tasks.

### Who can see what

Row-level security (the database's own rule about which rows each person may
touch) was turned on in the same step that created the table, so there was
never a moment without it. A signed-in member can read, add, change and delete
**only their own** tasks. They cannot add a task in someone else's name. A
visitor who is not signed in gets nothing at all.

The server holds one key (the "service role" key) that can see everything. It
never goes to the browser.

This is proved, not assumed: `npm run check:tasks-rls` makes two throwaway
members, has each write a task, checks that neither can read, change or delete
the other's (tasks, settings and attached files alike), and then deletes them
both along with their files.

## Why the four fields are there from day one

WaveCenter starts as a simple to-do list, but the list is a seed (CLAUDE.md).
A to-do list only needs a title and a tick box. These four are there because
of where it is going:

- **Owner.** In a DEO every act of engagement is credited to the member who
  performed it. A task with no owner is work nobody gets credit for. Adding
  owners later would mean guessing who did the old work.
- **Status.** The project management tool (roadmap step 2) is built on tasks
  moving through stages. `done` is also the moment a contribution becomes
  something to credit, which is why `completed_at` is recorded.
- **Parent task.** Step 5 breaks Dane's plan into tasks with defined points.
  A plan is a tree: big tasks made of smaller ones. With a parent on every
  task, the tree already exists in the data. If a parent task is deleted, its
  children stay and simply become top-level, so no member's record of work
  disappears with someone else's deletion.
- **Points.** Points on the first to-do item are the earliest form of the
  whitepaper's engagement ledger. Today the number is just stored; nothing
  calculates it.

## How this grows

These are later tickets, not designs. Each one is a **new table that points
at `tasks`**, so none of them needs this table rebuilt.

- **What each kind of engagement is worth.** The whitepaper says members vote
  on what each kind of engagement is worth, so values settle at their natural
  level. That becomes a valuation table (kinds of engagement and their voted
  values) plus a votes table. A task would then gain a "kind" column, and its
  `points` would be set from the valuation instead of typed in.
- **Reputation.** Voting weight is earned tokens multiplied by a reputation
  score that cannot be transferred. Reputation belongs to a member, not a
  task, so it lives in its own table keyed by member and is built up from
  their completed tasks.
- **Member-to-member engagement.** Once others are invited in, work happens
  between members: reviewing, helping, inviting. Those become engagement
  records naming who did what for whom, each able to point at the task it
  was about.

When several members share a project, the "only your own tasks" rule will
widen to "tasks in projects you belong to". That is a change to the rules,
not to the table.

## Open questions for Dane

The whitepaper does not settle these, so the table leaves them open rather
than guessing:

1. **Can points be negative?** Today any whole number is accepted.
2. **Are a finished task's points fixed?** Today the owner can still change
   points after a task is done. A ledger may need them locked once credited.
3. **Who sets points before voting exists?** Today it is the task's owner.
