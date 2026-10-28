# core/ — WaveCenter's heart, independent of any framework

Everything that defines WaveCenter as a DEO lives here: the task record, the
points rules, and the rules for who may do what. It is plain TypeScript with
its own tests.

**Nothing in this folder may import Next.js, React, or anything from Vercel.**
That is Dane's condition (2026-10-11) for choosing Next.js at all: the website
in `app/` is the first *client* of this core, and member-built tools are later
clients. If the framework is ever replaced, this folder does not change.
`npm run check:core-boundary` enforces it, and CI runs that check.

## What is here

| File | What it does |
|---|---|
| `tasks.ts` | The task record, and `createTask` / `updateTask` / `deleteTask`: the only path for making, changing or deleting a task. A parent must be a task you can see, and a task can never end up under its own sub-task. |
| `agents.ts` | The "Launch AI Agents" switch (`setAgentsOn`), `agentOrder` (the order agents take ticked tasks in, highest priority first, then oldest first), and the hand-off to the Loop Queue: `handOffTask`, `completeHandOff`, `returnHandOff`. |
| `files.ts` | `attachFile` / `removeFile` / `deleteTaskWithFiles`: files attached to a task. A name, at most 10 MB, a task you can see, and a tool name are required; the stored copy and its record are kept in step, so a failure leaves nothing half-saved. |
| `game.ts` | The game layer: the kinds of engagement and what each is worth (`STARTING_SCORING_RULES`), `engagementKindForTask` (which kind a task change is) and `recordEngagement` (score one engagement from the rules and write it; a tool can never set the points). The database applies the same rules inside every save, so each change and its engagement land together or not at all. |
| `points.ts` | `setPoints` / `awardPoints`: the only functions that may change a task's points. |
| `tool.ts` | Every change names the tool that made it; a change with no tool name is refused. |
| `memoryTaskStore.ts`, `memoryTaskFileStore.ts`, `memoryEngagementStore.ts` | Keep tasks, files and the engagement ledger in memory so the tests can check the rules without a database. Given a ledger, the task and file stores score every change the way the database does. |

Core does not talk to Supabase. Each client hands it a `TaskStore`, a thin
adapter that reads and writes rows and decides nothing (the scripts' one is
`scripts/lib/restTaskStore.mjs`; the website's is `app/lib/taskStore.ts`), and
for files a `TaskFileStore` (the website's is `app/lib/taskFileStore.ts`). The Game page reads the
ledger through an `EngagementLedger` (`app/lib/engagementStore.ts`); nothing
outside the database writes it. The tests (`*.test.ts`) run in `npm test`.
