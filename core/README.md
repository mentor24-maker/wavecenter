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
| `tasks.ts` | The task record, and `createTask` / `updateTask` / `approveTask` / `deleteTask`: the only path for making, changing, approving or deleting a task. A task added by anyone but an admin starts as proposed, and only an admin approves it. A parent must be one of your own tasks, and a task can never end up under its own sub-task. Every member may read every task, but a `TaskStore`'s `get` returns only the caller's own: the tasks they may change. |
| `agents.ts` | The "Launch AI Agents" switch (`setAgentsOn`), `agentOrder` (the order agents take ticked tasks in, highest priority first, then oldest first), and the hand-off to the Loop Queue: `handOffTask`, `completeHandOff`, `returnHandOff`. |
| `files.ts` | `attachFile` / `removeFile` / `deleteTaskWithFiles`: files attached to a task. A name, at most 10 MB, a task you can see, and a tool name are required; the stored copy and its record are kept in step, so a failure leaves nothing half-saved. |
| `game.ts` | The game layer: the kinds of engagement and what each is worth (`STARTING_SCORING_RULES`), `engagementKindForTask` (which kind a task change is) and `recordEngagement` (score one engagement from the rules and write it; a tool can never set the points). The database applies the same rules inside every save, so each change and its engagement land together or not at all. |
| `score.ts` | `scoreFinishedTasks`: a member's score from their finished tasks, the number finished and the total of their points. Only a `done` task counts. |
| `members.ts` | Members' roles and what each may do: the five `ROLES`, the expandable `PERMISSIONS`, `STARTING_ROLE_PERMISSIONS` (which role has which), `memberPermissions(role)`, `mayManageMembers(role)` (admins only) and `setMemberRole`: only an admin changes a role, the last admin cannot be made anything else, and the change names its tool. A member with no role recorded is a contributor. The permissions are recorded, not yet enforced on tasks. |
| `points.ts` | `setPoints` / `awardPoints`: the only functions that may change a task's points. |
| `votes.ts` | Members' votes on a task's points and priority: `castVote` (cast, change or withdraw your own), `summarizeVotes` and `votedValues` (the average, which becomes the task's points and priority; the database applies the same rule inside every vote), and `requireNotVotedOn` (an owner cannot type over a voted value). |
| `richText.ts` | The small rich-text format a Discussion comment is written in: `**bold**`, `*italic*`, `- ` and `1. ` lists, and links. `parseRichText` turns a comment into plain objects a client draws (never HTML), `safeHref` lets a link go only to http:, https: or mailto:, `richTextPlain` gives the words a comment shows, `richTextSearchable` adds its link addresses for the search box, and `applyFormat` / `applyLink` are what the comment box's toolbar buttons do. |
| `tool.ts` | Every change names the tool that made it; a change with no tool name is refused. |
| `memoryTaskStore.ts`, `memoryTaskFileStore.ts`, `memoryEngagementStore.ts`, `memoryVoteStore.ts`, `memoryMemberRoleStore.ts` | Keep tasks, files, the engagement ledger, votes and members' roles in memory so the tests can check the rules without a database. Given a ledger, the task and file stores score every change the way the database does. |

Core does not talk to Supabase. Each client hands it a `TaskStore`, a thin
adapter that reads and writes rows and decides nothing (the scripts' one is
`scripts/lib/restTaskStore.mjs`; the website's is `app/lib/taskStore.ts`), and
for files a `TaskFileStore` (the website's is `app/lib/taskFileStore.ts`), and
for votes a `VoteStore` (`app/lib/voteStore.ts`), and for roles a
`MemberRoleStore` (`app/lib/memberRoleStore.ts`). The Game page reads the
ledger through an `EngagementLedger` (`app/lib/engagementStore.ts`); nothing
outside the database writes it. The tests (`*.test.ts`) run in `npm test`.
