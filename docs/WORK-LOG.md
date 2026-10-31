# WaveCenter work log

A plain-English record, newest first, one entry per merged pull request.
Each entry is written INSIDE the pull request it describes, so it lands on
`main` at the same moment the work does. Never edit this file directly on
`main`.

---

## 2026-10-31 — A camera for WaveCenter's history: a picture after every change (#74)

WaveCenter now has the camera and the photo album for its own history.
The album is a new private table and picture store on the live database,
which every signed-in member can look at and nobody can change from the
browser. The camera is a script on the Mac Mini. For any past change it
rebuilds that old version of WaveCenter, fills a private local copy of the
database with the real tasks, members and points as they stood the moment
that change went live, signs in as Dane, and takes a picture of the screen
the change touched. Then it wipes the local copy, so real member data never
lingers there. The old version never sees a live key, and live data is only
ever read. After this merges, the camera runs once over every change since
the first commit. Two follow-up tickets then add a picture on every merge
and a page where members scroll through them.

## 2026-10-31 — Database changes can go live again when Dane writes merge (#78)

Since 29 October, every pull request that changed the database was refused
by the merge lane, even after Dane wrote `merge`, and five tickets were
stuck waiting. The cause: the Supabase tool only gives its tidy,
machine-readable answer when it thinks an AI assistant is running it. The
merge lane runs on the Mac Mini on a timer with no assistant, so the tool
answered in plain English and the lane could not read it. The lane now reads
the plain-English answer too, and always runs the tool the same way, so what
a Claude session tests is exactly what the lane sees. If the answer is
anything it does not recognise, it still refuses rather than guess.

## 2026-10-31 — The top banner is taller, with a bigger logo and name (#77)

Dane asked for the bar across the top of every page to stand out more. It
is now 150px tall instead of 90px, and the gold-and-aqua rings and the
"WaveCenter" name grew by the same amount, so the header reads bigger and
bolder while the menu and Sign out stay the size they were. On a phone the
bar is just as tall, but the rings stay a little smaller there so they do
not bump into the menu.

## 2026-10-31 — Teams gets its own place in the top menu (#72)

Signed-in members now see **Teams** in the top menu, right after
Members. It opens a
new Teams page that explains what a Team is (a group of members focused on
one part of the WaveCenter project) and names the example teams: UX Design,
Community, App Pipeline, Blockchain, Privacy, Security and Infrastructure.
Nothing is saved yet; joining teams and managing them come in later tasks.
This gives those tasks a home to build on.

## 2026-10-31 — Table headings become a dark blue bar (#76)

The header rows of the Tasks list and the Members table were plain grey
text with a line under them, easy to lose. Now each is a dark blue bar
with white bold column names and no line, the way Dane asked, with
"Actions" centred. The white text is easy to read on the blue (it passes
the accessibility contrast mark with room to spare), the sorted column
still shows its arrow, and the keyboard outline turns white so it shows
up. The read-only tables on the Game and Members pages stay as they were.

## 2026-10-31 — The home page becomes a landing page with the log-in form on it (#75)

Visitors who were not logged in used to see a plain placeholder page with
"Log in" and "Register" buttons that took them somewhere else. Now the home
page is a proper front door: Dane's water-drop picture fills the screen, the
logo sits top left, the introduction to WaveCenter is on the left, and the
box to log in with email and password is right there on the right, with the
"Forgot your password?" and "Register" links under it. A wrong password or
a mistyped email is explained on the home page itself. The home page and the
separate log-in page now share one form, so their wording can never drift
apart. On a phone, the introduction sits above the form.

## 2026-10-31 — A Team Manager page: group members into teams (#73)

Dane can now group members into teams. A new **Teams** page (in the header
menu) lists every team with its name, a short web-address name called a
slug, a description and how many members it has; clicking a team shows who
is on it. Admins and editors, the choice Dane made on the ticket, can make,
change and delete teams and add or take members off them; everyone else can
look but sees no buttons. Members on a team are shown exactly as their own
privacy setting allows: a private member appears only as "Anonymous member",
and no email address ever shows. Deleting a team never deletes anyone's
account. The two new database tables were locked down from the moment they
were made, and sixteen new automatic checks prove a member without
permission cannot change them.

## 2026-10-31 — Register, confirm your email, and log in with a password (#71)

Logging in used to mean typing your email and waiting for a one-time link.
Now WaveCenter works the standard way: a new visitor registers with an email
and a password, confirms the address from the email they are sent, and from
then on logs in with email and password. "Forgot your password?" emails a
link to set a new one, and that is also how members who joined before
passwords existed set their first. Every mistake (a wrong password, two
passwords that do not match, an email already registered, an email that
could not be sent) shows a plain message instead of failing quietly. The
live Supabase project needs its "Confirm email" setting switched on for the
confirm step to be required.

## 2026-10-31 — Done tasks sit on a light grey row instead of being crossed out (#70)

On the Tasks page, a finished task's title used to be crossed out and
faded, which made it hard to read. Now the title stays plain and black, and
the whole row sits on a light grey background, so done tasks still stand
apart from open ones without being hard to read. On a device set to dark
mode the row is a dark grey a shade lighter than the page, with the usual
light text. Every colour on the grey was measured to stay easy to read.

## 2026-10-30 — Admins get an Admin menu item and a placeholder Admin page (#68)

Admins needed a place for the powerful tools still to come. The top menu now
shows **Admin** to members whose role is Admin, and to nobody else. It opens
a new Admin page that, for now, says the tools are not built yet and are
coming in later tasks. Hiding the link is not enough, because anyone can
type the address, so the page checks the role too: another role is told,
by name, that it may not open the Admin area. If WaveCenter can't read
someone's role, it plays safe: no link, and the page says the role could not
be loaded. One rule decides who counts as an admin, and the menu and the page
share it, so they can't disagree.

## 2026-10-30 — The Add Task box folds shut and turns a darker blue (#66)

On the Tasks page, the whole Add Task form used to sit open above the task
list, so members scrolled past it every time. Now it folds shut behind its
heading, the same way the Done section does: click "Add Task" to open it,
click again to fold it, and it starts shut every time the page loads. If
adding a task fails, the form stays open so the error is never hidden. The
box is also a deeper blue, with its link colour and gold border darkened
just enough that everything in it stays easy to read.

## 2026-10-30 — A tidier top bar: name and Sign out at the top, menu along the bottom (#67)

Dane asked for the signed-in part of the header to be laid out more neatly.
His name and the Sign out button now sit in smaller text at the top right of
the bar, and the menu (Home, Tasks, Game, Profile, Members) runs along the
bottom edge, where before they sat side by side in the middle. The bar is the
same height and the logo is in the same place. Sign out also gained the soft
shadow the rest of the header text has, so the smaller words still read
clearly over the water-drop picture. On a phone, every menu item and Sign out
still fit on screen.

## 2026-10-30 — The header shows the water-drop picture the other way round (#65)

Dane wanted the version of the header picture with the dark colours on the
left. It is the same picture flipped left to right, so the old one was flipped
and swapped in, and the old file removed. Flipping it put the bright gold behind
the menu on the right, which would have made the white menu hard to read. So
the shading over the picture changed too: lighter over the dark left side where
the WaveCenter name sits, heavier over the gold where the menu sits, and even
across the whole bar on narrower screens. The text stays clearly readable at
every width.

## 2026-10-30 — What is a DEO now explains what a DEO is (#64)

The What is a DEO page used to show a single paragraph and a note saying more
was coming. It now gives a newcomer a two-minute summary of Dane's DEO
whitepaper, in seven short sections: engagement instead of money as the
starting point, the game layer that counts every contribution, how decisions
are made, why nobody is paid in dollars inside, privacy and invited members,
AI that helps people rather than replacing them, and the four seasons a DEO
grows through. Every sentence comes from the whitepaper, and the page ends
with a link to the whitepaper itself. The About WaveCenter page is unchanged.

## 2026-10-30 — One stuck task no longer holds up every ticked task behind it (#63)

This afternoon three hand-off passes in a row froze on the same task, and
the ten tasks waiting behind it sat for about five hours while the Loop
Queue looked empty. Now the hand-off lane remembers which task each pass
took. Once two passes have taken a task and neither filed its ticket, the
next pass skips it and hands over the next task instead, and names the
skipped task by its title in its report and in the lane's log, so Dane can
see which one is stuck. The task is tried again once it gets a ticket, is
edited, or is unticked and ticked again. A hand-off pass may now run for 15
minutes instead of two hours (a working one takes a minute or two), so a
frozen pass costs minutes. Build and review keep their two-hour limit.

## 2026-10-30 — The agents check for work more often (#62)

The agent jobs on the Mac Mini rest between passes. Until now each one rested
30 minutes, so a task Dane ticked could sit for about an hour and a half in
those rests before it was handed over, built and reviewed, for roughly ten
minutes of actual work. Now the job that picks up ticked tasks checks every
10 minutes, and the build and review jobs every 15. The merge job stays at
10. The docs and skills that said "30 minutes" now say the new times. The new
schedule takes effect once it is reinstalled on the Mini after merge.

## 2026-10-30 — The Tasks page opens on the work still to do (#61)

The Tasks page now starts with its Status filter set to Open, so the first
thing a member sees is what is left to do. The finished tasks sit folded
under a "Done (N)" heading that shows how many there are; clicking it opens
them and switches the filter to Any status (Dane's choice), and clicking it
again folds them away. "Clear filters" now goes back to this starting view.
This matters because the list was growing a long tail of finished work that
pushed the open tasks out of the way.

## 2026-10-30 — An admin can now set what each action is worth, and add new actions, on a Game management screen (#57)

What each action earns (1 point for making a task, 5 for finishing one, and
so on) used to change only through a code change. Now an admin opens
**Manage** in the Game menu and changes any action's name, wording
and points. The new value counts from the next time someone does it, and
points already earned keep their old value. An admin can also add a brand-new
action, as Dane chose; it shows as "Not active yet" and earns nothing until
an agent wires it into WaveCenter. Every working action shows the piece of
code that triggers it and the test that proves it, so anyone can check.
Only admins see Manage in the menu or can do any of this; anyone else who
opens the page is told only an admin may, and the database refuses them too.

## 2026-10-30 — Agents can read the DEO whitepaper from the repository (#59)

Your whitepaper, "The Decentralized Engagement Organization (Dane v2)", now
lives in a public folder, `docs/canon/`, copied word for word from your
Google Doc, with both of its pictures (the cover logo and the section 3
diagram comparing a traditional business with a DEO). Until now the agents
only had a short digest, which is why pages like What is a DEO came out
thin. `CLAUDE.md` and `docs/MISSION.md` now point every agent at the full
text, and the folder's note says agents quote it but never rewrite it.
Edit the Google Doc first; this copy follows it.

## 2026-10-30 — Members can read how WaveCenter protects their privacy (#58)

Your profile now has a box called "Your privacy on WaveCenter": a few short
paragraphs saying that profiles start anonymous, that each member lives in
their own Wave Bubble, and how Security (Filters) and Privacy (Masks) work.
At the bottom, a link opens a new page inside WaveCenter, "Privacy and
Security First", which carries Dane's full article from the public website,
word for word. Anyone can read that page, signed in or not. This matters
because the profile page asks members what to share; now it also tells them
why WaveCenter starts them hidden, without sending them off to another site.

---

## 2026-10-30 — The Game area gets a menu: My Points, Leaderboard and Manage (#56)

The Game page now has a small menu under its heading with three choices.
My Points is the Game page as it was: your points, your finished tasks,
how points are earned and your latest engagements. Leaderboard and Manage
are new pages that, for now, say in one plain sentence that they are coming
in a later task, so they never look blank or broken. The menu underlines the
page you are on. This gives the later leaderboard and game-management work
a place to land.

---

## 2026-10-30 — WaveCenter gets a Home page; the task list moves to its own Tasks page (#54)

Signing in now lands on Home, a dashboard instead of the raw task list. It
has five boxes: About WaveCenter and What is a DEO (each opens its own
page), the tasks someone is working on right now (each title opens that
task), a Leaderboard box that says it is coming, and the newest members
(shown only as their profile allows, so a private member stays
"Anonymous member"). The menu now starts with Home, and the task list
works exactly as before at its own Tasks address. The About and DEO pages
carry the mission paragraph for now, as Dane chose, until he writes their
own text.

---

## 2026-10-30 — Ten ideas for the home page, written down for Dane to pick from (#53)

Dane asked for ten ideas for what a visitor should see on WaveCenter's front
page before logging in. They are now in a new document,
`docs/HOME_PAGE_IDEAS.md`. Six show off what already works (what WaveCenter
is, what a member can do, how points are earned, the AI agents helping while
people decide, members choosing what others see of them, and running counts
of what members have done). Four point at what comes next (the five-step
path with a "you are here" marker, the Winter season, joining by invitation,
and open tasks with their points waiting to be picked up). Nothing on the
site changed; building any idea is a separate ticket once Dane chooses.

---

## 2026-10-30 — Database changes are tested privately and go live only on Dane's merge (#52)

Until now, a session tested a database change by putting it straight onto the
live database, before Dane had approved it. On 2026-10-29 one such change had
a bug, and the live member list failed for about five minutes. Now every
database change is first tried on a private test copy that runs on the Mac
Mini (free, and kept apart from StarCaster's own test copy there). The live
database only changes when Dane writes `merge`: the merge lane applies the
change a moment before it merges the code, checks that it landed, and says so
on the ticket. If the change fails, nothing is merged and the ticket says what
went wrong, so the site never runs code whose database change is missing.

---

## 2026-10-30 — Every page is now the same width (#55)

Moving between pages in WaveCenter no longer makes the page jump wider or
narrower. Every page (the task list, a task's own page, Members, Profile,
Game and Sign in) now has the same 1440px-wide main area, centred, and the
header bar's logo and Sign out line up with its edges. Before, the task list
was 1216px and every other page only 704px. The sign-in and profile forms
keep their narrow width so they do not stretch across the screen, and phones
look the same as before.

---

## 2026-10-29 — The Launch AI Agents switch moves up beside the Tasks heading (#48)

The "Launch AI Agents" switch now sits at the right-hand end of the Tasks
heading line instead of taking up its own box above the list. The two lines
that explain it (whether agents are on and how many tasks are waiting, and
what turning it off does) now pop up only when the mouse is over the switch
or it is reached with the keyboard, so the top of the page is tidier. Screen
readers still hear the explanation. If the switch cannot be read or a save
fails, that message still shows on the page without hovering.

---

## 2026-10-29 — The header shows your name above Sign out, and says Log in (#50)

The top right of every page now shows the name a member chose on their
Profile page, with Sign out just beneath it, instead of their email. A
member who has not picked a name yet still sees their email there, so the
header always says who is logged in, and if the profile cannot be read the
page still loads with the email. Everywhere a member used to read
"Sign in" now says "Log in", from the header link to the log-in page and
its messages.

## 2026-10-29 — Next.js upgraded to close a critical security hole (#46)

WaveCenter's server ran on a version of Next.js, the framework it is built
on, with a known critical flaw: an outsider could have run their own code on
the server, or knocked it over, without signing in. It now runs on 16.4.3,
the small patch release that fixes it, and nothing else changed. The
security audit now finds no known problems, the checks pass first time, and
signing in, adding a task with a picture and seeing its thumbnail all still
work.

## 2026-10-29 — Members view-only for non-admins: already done, one note corrected (#49)

This ticket asked that members who are not admins see the members list,
read only. When we checked before building, that had already shipped the
same day in #44: every member can open Members and see who is there and
their roles, and only an admin can change a role. The live database
checks confirm it, and a signed-out visitor is still turned away. The
only thing left was a note in the code that still said "admins only", so
this change corrects that note and adds nothing else.

## 2026-10-29 — Every member sees Members in the menu (#45)

Until now only admins saw the Members link in the top menu. Dane decided
every signed-in member should see it, so now the menu reads Tasks, Game,
Profile, Members for everyone. A member who is not an admin who clicks it
sees the members table to read, with a line saying only an admin can change
a role, so they get exactly what Dane asked for: view only, with editing
kept for admins. Because the menu no longer depends on who is an admin,
each page also skips one database question it used to ask on every load.

## 2026-10-29 — A taller header with a bigger logo and name (#51)

The bar across the top of every page is now half as tall again, and the
gold-and-aqua rings logo and the "WaveCenter" name grew by the same amount,
so the header has more presence. The menu links, the email and Sign out kept
their size and sit in the middle of the taller bar. On a phone the header
still fits on one row with Sign out on screen.

## 2026-10-29 — The Add Task form has its own box, so it is easy to spot (#47)

The form for adding a task used to sit loose on the task list page, easy to
miss among the boxes around it. It now lives in its own box with a gold
border, rounded corners and the heading "Add Task", on the darkest shade of
the aquamarine colours, so it reads at a glance as the place to start. On a
device set to dark mode the colours run the other way, so there the box is
the brightest, most "raised" one instead. Adding a task works exactly as
before.

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
