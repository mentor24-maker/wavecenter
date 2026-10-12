# WaveCenter work log

A plain-English record, newest first, one entry per merged pull request.
Each entry is written INSIDE the pull request it describes, so it lands on
`main` at the same moment the work does. Never edit this file directly on
`main`.

---

## 2026-10-11 — How members' tools will plug into WaveCenter: options for Dane (#13)

Before anyone outside is invited in, WaveCenter needs a plan for how a
member's own tool, game or community connects to it and earns points. A new
page, `docs/EXTENSION_MODEL.md`, quotes what the DEO whitepaper says, lays out
three ways to do it in plain words, and recommends one: a published "door"
into WaveCenter's core that any tool, hosted anywhere, can use, with WaveCenter
alone deciding what each action is worth. Its first step costs almost nothing
now and rules nothing out. Seven questions the whitepaper leaves open are
waiting on Dane. No code changed.
---

## 2026-10-11 — A leaked key now turns the build red (#12)

The rule "every key lives in Doppler, never in a file" used to be a promise in
the docs. Now it is checked. `npm run doctor` lists every key WaveCenter
expects and says whether Doppler has it, without ever showing a key itself.
And the standard build check now refuses any change that contains a `.env`
file or something shaped like a ClickUp or Supabase secret key, which matters
because this repository is public. It was proved by planting a fake key and
watching the check fail.
---

## 2026-10-11 — WaveCenter's first table: a task record built to grow (#10)

WaveCenter now has its first piece of stored data: a `tasks` table. Even
though the first screen will just be a to-do list, every task already records
who owns it, where it stands (to do, doing, done), which bigger task it is
part of, and how many points it is worth. Those four are what the project
management tool and the game layer will need later, so adding them now avoids
a rebuild. Members can only ever see and change their own tasks, and that was
switched on in the same step that made the table. A small check makes two
throwaway members and proves neither can touch the other's tasks.
`docs/DATA_MODEL.md` explains it all in plain words and lists three questions
about points that only Dane can answer.
---

## 2026-10-11 — The WaveCenter loops run by themselves on the Mac Mini (#9)

Until now a WaveCenter loop only ran while someone had a session open that had
started it. The Mac Mini, Dane's always-on machine, now runs both lanes the way
it runs StarCaster's: every 30 minutes it pulls `main`, runs one build pass and
one review pass, each in a fresh session with a two-hour limit, and restarts
them after a crash or reboot. The queue drains overnight. Merges still wait
for Dane's word and a session to carry it out.

---

## 2026-10-11 — WaveCenter is live: a placeholder page on Vercel (#6)

There is now a WaveCenter website, deployed from `main` by Vercel, with a
preview link for every pull request. The page says what WaveCenter is and that
it is coming soon. Under it sits the Next.js skeleton (TypeScript) that Dane
chose after weighing it against a plain server like StarCaster's, on two
conditions now enforced by code: the core of the system lives in its own
folder that never imports the framework, and only standard hosting features
are used so the site can move hosts if it ever must. `main` cannot be merged
into unless the `verify` check passes.

---

## 2026-10-11 — WaveCenter gets its own database (#4)

WaveCenter now has its own Supabase project, separate from StarCaster's, so a
problem in one can never take the other down. Its address and keys are stored
in the new `wavecenter` Doppler project, never in the repository. One thing
learned the hard way: the default database address only works over IPv6, which
Dane's network lacks, so WaveCenter connects through Supabase's IPv4 pooler
instead. `docs/INFRASTRUCTURE.md` records all of it. No tables exist yet.

---

## 2026-10-11 — The WaveCenter space gets its own development loop (#2)

WaveCenter now has the same spec → build → review process StarCaster runs,
pointed at its own ClickUp list, **Loop Queue** in the WaveCenter space. This
repo gained the three loop skills, a small command-line door into ClickUp
(`npm run clickup`), an operator guide, the click-by-click status setup for the
new list, a CI check, and a guard that refuses edits on `main`. Keys live in a
new `wavecenter` Doppler project from day one; the ClickUp token is borrowed
from StarCaster's by reference rather than copied.
