# WaveCenter work log

A plain-English record, newest first, one entry per merged pull request.
Each entry is written INSIDE the pull request it describes, so it lands on
`main` at the same moment the work does. Never edit this file directly on
`main`.

---

## 2026-10-13 — Sign-in links asked for on app.wavecenter.com now land there (#19)

When the new address app.wavecenter.com went live, a sign-in link asked for
there opened the old app-wavecenter.vercel.app address instead. Supabase,
which sends the email, only sends people back to addresses on its approved
list, and the new one was missing. It is now on the list and is the main
address, so the link brings Dane back to app.wavecenter.com. The setup notes
now say plainly that any new address the app answers on must be added to
that list the same day.

---

## 2026-10-12 — Tasks Dane ticks for AI agents now reach them (#20)

Ticking a task and turning on "Launch AI Agents" now actually hands the task
over. A new helper on the Mac Mini checks every 30 minutes. It takes the
first ticked task in line (most urgent first, then oldest), writes it up as
a proper work ticket in the Loop Queue, and the usual build, review and
merge steps do the rest, so nothing ships without review and Dane's
written "merge". The task then says "With AI agents" with a link to its
ticket. When the ticket ships, the task is ticked off by itself; if the
ticket is dropped, the task comes back with a note saying why. Turning the
switch off stops new hand-offs, and the screen says so. A task can never be
handed over twice. Dane's task about the add form, which a session had
already filed by hand as two tickets, is marked as with the agents so the
helper does not file it a third time.

---

## 2026-10-12 — WaveCenter looks like a real place (#17)

Every page now has a header with the WaveCenter name and a small wave mark,
plus a way to sign in or out. The app uses one sea-blue accent colour,
readable type and the same spacing throughout, in light and dark mode alike.
Error messages sit in a tinted box so they cannot be missed; before, they
were hard to read on a light screen. On a phone, each task's buttons now sit
neatly under its name, and neither a long task title nor a long file
name can push the page sideways; the attach links and file thumbnails wear
the same look. The infrastructure notes now record where the
wavecenter.com domain is registered, who runs its DNS and email, and the one
record that put the app at app.wavecenter.com, where it is now live.

---

## 2026-10-12 — Dane can attach files and pictures to a task (#22)

Every task now has an "attach" link, and so does the add box. Pick a file
and it is saved with the task: pictures show as small thumbnails you can
click to open, other files as a name you click to download, and each has a
"remove" link. A file over 10 MB is refused straight away with a message
saying so. The files are stored privately in the database's own file
storage, never on the web host's disk, and each member can reach only their
own. If an upload fails part-way, the screen says so and nothing
half-saved is left behind. Deleting a task deletes its files too. This is
what Dane needs to hand over the WaveCenter logo and favicon.

---

## 2026-10-12 — Adding a task takes details, a parent and a priority (#21)

Adding a task used to mean typing a title and nothing else. The add box is
now a small form: the title (Enter still adds it), a box for details, a
choice of which task it sits under, and its priority. If the add fails, for
example because the internet dropped, the form says so and keeps everything
typed. Each task in the list shows the first line of its details, with a
"more" link for the rest, and "edit" changes the title and details together.
Attaching files and images comes next, in its own ticket.

---

## 2026-10-12 — Dane can choose which tasks AI agents work on (#18)

The to-do list has a "Launch AI Agents" switch, a box on every open task
that says "AI may work on this", a tick-all box above the list, and a
priority (Urgent, High, Normal, Low) on every task. With the switch on, each
ticked task shows its place in line, highest priority first, then oldest
first. These are Dane's choices only, saved and protected so no other member
can see or change them; actually handing the ticked tasks to the agents is
the next ticket, and until it ships the screen says so.

---

## 2026-10-12 — WaveCenter is a to-do list Dane can use (#16)

"Your tasks" now works as a to-do list. Type a task and press Enter to add
it, tick it off to move it under Done, untick it to bring it back, rename it,
delete it, give it points, and tuck it under another task as a sub-task. This
is the seed the project manager grows from, so every task already carries
its owner, status, parent and points. Every change goes through the same
front door a member's own tool will use later. If a save fails, for example
because the internet dropped, the screen says so in red and keeps what you
typed, instead of pretending it worked. It fits a phone screen.
---

## 2026-10-11 — Points can only change through one front door (#15)

A task's points are the start of the engagement ledger, so they should never
be changed by just editing the database. Now there is one front door: a small
set of functions in WaveCenter's core. Every change must say which tool made
it (WaveCenter's own app is "wavecenter"), and a change that does not say is
refused. Each task now records which tool last changed it. Two changes to the
same task's points at the same moment can no longer quietly cancel each other
out. This is the groundwork for members' own tools: when they arrive, they
earn points through the same door as everything else. Nothing on screen
changed.
---

## 2026-10-11 — Writing "merge" on a ticket now merges it (#14)

On StarCaster, Dane writes `merge` on a finished ticket and it ships. On
WaveCenter nothing was reading that word, so three of his merges sat for up
to three hours. Now a small script on the Mac Mini checks every 10 minutes.
When his own newest comment on a `Ready to launch` ticket is `merge` (or
`merge it`, `ship it`, `approve`), it merges the pull request, but only if
the automatic checks are green, and marks the ticket `Live` once GitHub
confirms the merge. If something blocks it, it says why on the ticket once.
The same script also notices when he answers a question on a `Needs your
input` ticket and puts it back in the queue, so he no longer has to move it
by hand. It does not use Claude, so it costs nothing to run.
---

## 2026-10-11 — Dane can sign in, and each person sees only their own tasks (#11)

WaveCenter now has sign-in. You type your email and get a link that signs you
in, with no password to remember. Once signed in, the home page says "Your
tasks"; signed out, it is the same "coming soon" page as before. Every request
for data runs as the person who is signed in, so the database's own rules hand
back only that person's tasks. A test with two throwaway accounts proved it:
one could not see the other's task. No key is sent to the browser at all, and
a new automatic check fails the build if one ever is. If WaveCenter cannot
reach the sign-in service, the page says so in a plain sentence instead of
quietly looking signed out.
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
