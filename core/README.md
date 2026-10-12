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
| `tasks.ts` | The task record, and `createTask` / `updateTask`: the only path for making or changing a task. |
| `points.ts` | `setPoints` / `awardPoints`: the only functions that may change a task's points. |
| `tool.ts` | Every change names the tool that made it; a change with no tool name is refused. |
| `memoryTaskStore.ts` | Keeps tasks in memory so the tests can check the rules without a database. |

Core does not talk to Supabase. Each client hands it a `TaskStore`, a thin
adapter that reads and writes rows and decides nothing (the scripts' one is
`scripts/lib/restTaskStore.mjs`). The tests (`*.test.ts`) run in `npm test`.
