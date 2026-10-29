# WaveCenter work log

A plain-English record, newest first, one entry per merged pull request.
Each entry is written INSIDE the pull request it describes, so it lands on
`main` at the same moment the work does. Never edit this file directly on
`main`.

---

## 2026-10-29 — Members view-only for non-admins: already done, one note corrected (#49)

This ticket asked that members who are not admins see the members list,
read only. When we checked before building, that had already shipped the
same day in #44: every member can open Members and see who is there and
their roles, and only an admin can change a role. The live database
checks confirm it, and a signed-out visitor is still turned away. The
only thing left was a note in the code that still said "admins only", so
this change corrects that note and adds nothing else.

## 2026-10-29 — Every member can view the Members table, filter it and sort it (#44)

The Members page is now one table that every member can open and read, not
just admins. A filter row narrows it by name or by role. Clicking Member,
Joined or Role sorts by that column, and a second click flips the order.
When a filter matches nobody, the table says so and offers a one-click
clear, so an empty table never looks broken. An Actions column holds only
the buttons your role is allowed to use. Today that is the role picker, and
only admins get it. Two new permissions, "View members" (every role) and
"Change member roles" (admins only), now appear in the Roles and permissions
table. Adding and removing members is left out for now, as Dane chose.

---

## 2026-10-29 — Members have roles, and an admin can change them (#43)

WaveCenter now knows five roles: Admin, Editor, Contributor, Reviewer and
Viewer, and a starting list of what each may do with tasks (read, create,
edit, delete). Dane is the first admin. A new Members page, in the menu for
admins only, lists everyone, showing only what each person's profile lets
others see (their avatar, and their name if they made it public), and lets
the admin change anyone's role with one pick. The database itself refuses a
role change from anyone who is not an admin, and will never let the last
admin be demoted, so WaveCenter can't end up with nobody in charge. For now
the roles are recorded and shown but don't yet change what anyone can do on
tasks; that's the next step.

Review caught one leak before this went live: a behind-the-scenes lookup
let any member ask the database for anyone else's role. That lookup is now
hidden where only the database's own rules can use it, and the safety check
proves a member can no longer peek. Also: the permission column headings on
the Members page no longer run together, and a role another admin changed
shows up when the page refreshes.

---

## 2026-10-29 — Dark mode gets the aquamarine and gold look too (#42)

Phones and computers set to dark mode were still showing WaveCenter's old
navy colours. Now they get a dark version of the new look: a deep sea-teal
taken from the dark part of the header picture, the same thin gold border
round every box, and the same rounded corners. In the dark, each box inside
another is one shade lighter, so you can still see how deep you are. Every
kind of text was measured and is easy to read on every shade, and error
messages and the outline round whatever you are typing in still stand out.
The light look did not change.

## 2026-10-29 — WaveCenter's new look: water-drop header, aquamarine boxes, gold borders (#41)

The first step of the facelift. The bar across the top is now Dane's
water-drop picture with the gold-and-aqua rings as the logo. The page behind
everything is a very light aquamarine, and each box that sits inside another
is one shade darker, so you can see at a glance how deep you are (the way
StarCaster's builder does it). Every box has a thin dark-gold border and
rounded corners, and the spacing is tighter, so the task list starts about a
fifth of a screen higher. All the text was measured and is easy to read on
every shade. Phones and computers set to dark mode keep a dark version for
now; a matching dark aquamarine look is its own ticket.

## 2026-10-28 — Tasks is the first item in the menu (#38)

The only way back to the task list was clicking the WaveCenter name, which
nothing pointed out. The menu at the top of every page now starts with
**Tasks**, then Game and Profile, so the list is one obvious click away from
anywhere. On a phone the four menu items didn't fit, so there the header now
shows the round logo without the "WaveCenter" word beside it. The logo still
leads home.

## 2026-10-28 — The Done box moved to the right, away from the AI box (#37)

Every open task started with two tick boxes that looked the same: one hands
the task to the AI agents, the other marks it done. Dane meant to hand three
tasks to the agents and marked them done instead, so they never reached the
agents. Now the only box at the left edge is the AI box, with "AI" written
above it. The Done box sits at the right end of the row, next to the edit,
attach, discussion and delete icons, with the word "Done" beside it. Ticking
it works exactly as before. On a phone the rows still line up, and a long
"Was with AI agents" label no longer pushes the page sideways.

## 2026-10-28 — Dark blue header and a light blue box for the task filters (#39)

The bar across the top of every page used the same dark or light colour as
the rest of the page, and the task filters sat loose above the list, so both
blended in. Now the top bar is a fixed dark navy blue with white bold
writing, and the task list's search box and dropdowns sit in their own pale
blue box with a dark blue border. Both look the same whether the computer is
in light or dark mode, and the writing inside the pale box stays dark so it
is easy to read. On a phone the top bar's spacing tightens a little so
"Sign out" stays on screen.

## 2026-10-28 — Discussion comments can be bold, italic, lists and links (#35)

Comments in a task's Discussion were plain text. Now the comment box has a
small toolbar: bold, italic, a bulleted list, a numbered list and a link,
with a Preview to see the comment before posting it. The thread shows each
comment formatted, and links open in a new tab. Safety came first: a comment
is saved as plain words with a few marks (like **two stars** for bold), and
WaveCenter's own code draws it, never treating it as web-page code. So a
pasted script or booby-trapped picture shows as harmless text, and a link
works only if it goes to an ordinary web or email address. Old comments read
as before, and the search box still finds the words of a formatted comment.
Pictures and files attached to a comment still show under it (#36).

---

## 2026-10-28 — Every task has its own page (#34)

Clicking a task's title on the list now opens a page just for that task.
It shows everything WaveCenter knows about the task in one place: status,
priority, points, who made it, and when it was created, last changed and
finished (in Mountain time). It also shows the full details with their
line breaks, links to its parent and sub-tasks, its attached files, and
the AI-agent ticket if it was handed off. The Discussion sits at the
bottom, closed until clicked. Nothing is edited here; the list is still
where changes are made. Another member's task opens too, read-only. A
wrong or deleted link says "This task was not found" instead of showing
a blank page. Pictures and files attached to Discussion comments show
in the thread there too, the same as on the list.

## 2026-10-28 — Each task shows the time it was created, not just the day (#33)

The Created column on the task list showed only the day, like "Oct 27".
The time was there but hidden, visible only by hovering. Now the column
reads "Oct 27, 4:14pm" in Mountain time, so you can see at a glance when
each task came in. Showing who created each task waits for member
profiles, as Dane chose.

## 2026-10-28 — Discussion comments can carry pictures and files (#36)

A comment in a task's Discussion can now have files attached. Under the
comment box there is an "attach" link; pick a picture or a document, write
the comment and post it. A picture shows under the comment as a small
thumbnail, anything else as a download link, and both are still there after
a reload. A file over 10 MB is refused straight away with a plain message.
Removing a comment, or deleting its task, removes its files from storage
too, so nothing is left behind that nobody can reach. A comment's files are
as private as the comment itself, and they stay out of the task's own file
list. A live check with two throwaway members proved neither can see,
add to or remove the other's comment files.

## 2026-10-27 — Every task has a Discussion thread (#31)

Each task now has a Discussion: a speech-bubble icon opens a thread of
comments under it, oldest first, where the story of the task can be told.
Dane can post, edit and delete his comments. Each one shows who wrote it,
a Human or AI label and the time in Mountain time. A search box and a
Human / AI selector narrow the thread, and when nothing matches the thread
says so instead of looking empty. A comment from an AI agent can be deleted
but not edited here, so it can never be relabelled as Human by mistake.
Comments are plain text and always shown as text, so nothing pasted into
one can run in the browser. The new comments table keeps each member's
comments to themselves from the moment it was created, and a live check
proved it. This is the first of three slices: rich text with links, and
attachments on comments, are queued next.

---

## 2026-10-27 — Members have a profile page, anonymous by default (#30)

There was nowhere for a member to say who they are, or to choose to stay
unnamed. Now a **Profile** link in the header opens "Your profile", where a
member can set a display name, pick one of eight built-in avatars, write a
short bio, and choose who may see it: Anonymous, Private or Public. Every
profile starts **Anonymous**, as WaveCenter's privacy article promises, and
the page says so. Only the member can read their own profile, whatever they
choose; a live check proved one member cannot read or change another's.
Saving a profile earns a point in the game layer like every other change. A
save that fails says so in red and is never shown as saved. Masks, Filters
and selling your own data come later.

---

## 2026-10-27 — The Game page shows the points from your finished tasks (#29)

The Game page already counted points for each thing a member does. It did
not show the points set on the tasks they have actually finished. Now it has
a "Your finished tasks" section: the total points of every task marked done,
how many that is, and a list with each task's title, points and the date it
was finished (Mountain time). Tasks still to do add nothing. With nothing
finished yet, the page says so and points back to the list. If the tasks
cannot be read, it says that, rather than showing a zero that is not true.
The sum is worked out in one shared place in WaveCenter's core, with tests,
so every future tool scores the same way. A visitor who is not signed in is
now sent straight to the sign-in page. Leaderboards and kinds of
contribution wait for their own tickets, as Dane chose.

---

## 2026-10-27 — Every member sees every task and votes on its points and priority (#32)

Until now each member saw only their own tasks, and a task's points and
priority were whatever its owner typed. Dane asked for the first piece of the
DEO's "members decide what engagement is worth": everyone can see the whole
list, past and present, and vote. Now every task shows whose it is, and under
it the average of the votes and how many members voted, plus your own vote:
a points number and a priority. The average becomes the task's points and
priority (priorities count as urgent 4, high 3, normal 2, low 1). A finished
task keeps its points locked. Members still change only their own tasks,
nobody can touch someone else's vote, and every vote is scored in the game
layer like any other action. The point for a vote goes to the voter only: the
task's owner earns nothing when someone else votes, deleting a task with votes
scores nobody, and a member who has voted can still have their account
deleted (their vote simply leaves the average).

---

## 2026-10-27 — The task list is wider, sortable and filterable (#26)

"Your tasks" was a narrow column with each task's controls jumbled on a
second line, which got hard to scan as the list grew. Now it uses the width
of a laptop screen and shows tasks in neat columns with a header row.
Clicking a column name (Title, Priority, Points or Created) sorts by it, and
clicking again flips the order. A filter bar narrows the list by words,
priority, status, points and who created the task: the five filters Dane
asked for. Sub-tasks always stay under their parent. Edit, attach and delete
are now small icons with tooltips. On a phone the extra columns wrap neatly
instead of pushing the page sideways. The date each task was added is always
shown in Mountain time, so the server and Dane's browser draw the same date
and the page no longer has to throw itself away and redraw on every load.

---

## 2026-10-27 — Points can't go below zero, and lock when a task is done (#28)

Dane answered the three open questions about points. A task's points are
its suggested value, so they can never be negative: WaveCenter now refuses
a negative number with a plain message, and the database itself refuses
one too, so no tool can slip past the rule. Once a task is ticked done, its
points are locked and the points box disappears; reopening the task unlocks
them again. The member who adds a task sets its value, which was already
true. Before the database rule went in, every existing task was checked:
none had negative points, so nobody's points were changed.

---

## 2026-10-27 — Everything you do in WaveCenter now earns points (#27)

This is the first piece of the game layer. Every time a member adds, changes,
finishes or deletes a task, attaches or removes a file, has a task handed to
the AI agents, or flips the AI agents switch, WaveCenter writes it down and
scores it. Finishing a task earns 5 points and everything else earns 1, for
now. The database does the scoring as part of the save itself, so nothing
can slip through unscored and nobody can award themselves extra points. If
the scoring part fails, the save fails too and the screen says so. A new
Game page, linked at the top once you are signed in, shows how points are
earned, your total, and what you did most recently.

---

## 2026-10-27 — WaveCenter's own logo replaces the placeholder wave (#25)

The browser tab and the top-left corner of every page showed a stand-in
blue wave drawn when the site was first set up. Both now show the
concentric-circles image Dane attached to his WaveCenter task, so the site
carries its real mark. The image has a white background, so the header
trims it to a circle; on the dark screen it reads as a neat white disc
rather than a white box.

---

## 2026-10-13 — A conflict no longer stalls Dane's "merge" (#24)

When Dane writes "merge" but the work clashes with something that reached
the main code first, the merge helper cannot merge it. Until now it posted a
note asking Dane to move the ticket back, and nothing else touched it: on
2026-10-12 an approved change sat for twelve hours that way. Now the build
agent picks such a ticket up on its next pass (within about 30 minutes),
combines the two versions keeping both, re-runs every check, and leaves a
note saying what clashed. The ticket stays in "Ready to launch" and Dane's
"merge" still counts, so the merge helper finishes the job once the checks
pass. If the two versions truly disagree, the agent asks Dane which one he
wants instead of guessing, once: neither the agent nor the merge helper
posts on that ticket again until he answers. That question ends by asking
him to reply with his choice and then write "merge" again, because his
answer alone does not count as a merge. The helper's note no longer asks
him to move anything.

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
