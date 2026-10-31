# WaveCenter data model

What WaveCenter stores, in plain words. The tables: `tasks`;
`member_settings`, which holds each member's "Launch AI Agents" switch;
`member_profiles`, each member's own profile;
`task_files`, the files attached to tasks, whose stored copies live in a
private file-storage bucket; `task_comments`, each task's Discussion; the
game layer's two, `game_scoring_rules` and `engagements`; and the four that
hold roles and permissions, `roles`, `permissions`, `role_permissions` and
`member_roles`; the two that hold teams, `teams` and `team_members`;
`evolution_entries`, the record of how WaveCenter looked after each change;
and `messages`, what admins write to members.
The exact definition is the migrations in `supabase/migrations/`
(`20261011120000_tasks.sql` made the table; `20261011200000_tasks_tool.sql`
added `tool`; `20261012180000_ai_agents.sql` added `priority`,
`agent_selected` and the `member_settings` table;
`20261012230000_agent_handoff.sql` added `agent_ticket_url`;
`20261013040000_task_files.sql` added `task_files` and the `task-files`
bucket; `20261027120000_game_layer.sql` added the game layer, and
`20261027130000_game_layer_cascades.sql` fixed how it treats deletes;
`20261028120000_member_profiles.sql` added `member_profiles`;
`20261028130000_task_comments.sql` added `task_comments`;
`20261028150000_comment_files.sql` let a file belong to a comment;
`20261029120000_member_roles.sql` added roles and permissions;
`20261029180000_member_role_private.sql` hid the role-lookup helper from the
API; `20261029210000_member_permissions.sql` added the member permissions and
let every member list the members; `20261031120000_teams.sql` added teams
and the team permissions; `20261031130000_evolution.sql` added
`evolution_entries` and the `evolution` bucket; `20261031150000_messages.sql`
added `messages` and the Message members permission); this page
explains them.

## The `tasks` table

One row is one task: something a member means to do, is doing, or has done.

| Column | What it holds |
|---|---|
| `id` | The task's permanent, unique identifier. Made automatically. |
| `title` | What the task is, in a few words. Required, and cannot be blank. |
| `notes` | Anything longer: detail, links, thoughts. Optional. |
| `owner_id` | **The member the task belongs to.** Filled in automatically with whoever is signed in. |
| `status` | **Where the task stands:** `proposed`, `todo`, `doing` or `done`. An admin's new task starts at `todo`; anyone else's starts at `proposed` and waits for an admin to approve it (`approve_task`), which makes it `todo`. A proposed task's status cannot change any other way, and it cannot be ticked for or handed to AI agents. No other values are accepted. |
| `parent_task_id` | **The bigger task this one is part of**, if any. Empty for a top-level task. |
| `points` | **What the task is worth**: its suggested value, as a whole number. Starts at 0, is never empty and never below zero. Locked once the task is done. |
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
cancel each other out: a points change only saves if the points and the
status are still what it read, and otherwise says "try again" and saves
nothing.

### Points rules

Dane settled these on 2026-10-27, in his own words. They answer the three
questions this document used to leave open.

1. **Points are never below zero.** "No, points can't be negative in terms of
   the initial proposal. There will be ways to assign negative values in other
   ways, such as feedback, but an initial suggested score would be inherently
   positive." `core/points.ts` refuses a negative number with a plain message,
   and the table itself refuses one too (`tasks_points_not_negative`). Zero is
   allowed; it is where every task starts.
2. **A done task's points are locked.** "Yes, points locked on completion.
   (for now) However, there will be many ways to add or subtract points
   related to a task. We're just gettingg started." `setPoints` and
   `awardPoints` refuse a done task and save nothing, and the to-do list shows
   a done task's points without the box to change them. Reopening the task
   unlocks them again, the same way reopening clears its ticket. (Dane did not
   mention reopening; this is the build's reading of "locked on completion".)
3. **The member who adds a task sets its suggested value.** "The person who
   adds a 'proposal', which is what these ToDo list items are gets to set a
   suggested value. Others can vote on the value separately." Only a task's
   owner, the member who added it, can change it directly (row-level
   security). **Once members have voted, the average replaces it** (Dane,
   2026-10-27; see "Votes on a task" below).
4. **Who sets points, once votes exist.** The average of the members' votes.
   The owner's own value stands only until the first points vote.

The game layer's scoring rules (what each recorded action earns) are a
separate thing from a task's points: an admin sets those on the Game
management screen (see "Who may change the scoring rules" below).

Adding or subtracting points in other ways (feedback, for example) comes
later as records of their own, not as edits to this number.

### Votes on a task: `task_votes`

Dane, 2026-10-27: "allow all users to vote on all tasks in terms of priority
and point values ... The actual value will be the average of all users'
votes. (for now)" On the ticket he settled three questions: the votes go on
the task list for now (a Game Layer page later), every member sees every
task including its details and files, and once there are votes the average
replaces the owner's own points and priority.

| Column | What it holds |
|---|---|
| `task_id` | The task voted on. If the task is deleted, its votes go with it. |
| `member_id` | Who voted. Filled in automatically; one vote per member per task. |
| `points` | Their points vote: a whole number from zero up, or empty. |
| `priority` | Their priority vote: urgent, high, normal or low, or empty. |
| `tool` | Which tool saved it. |
| `created_at`, `updated_at` | When it was first cast and last changed. |

A member can vote on points, on priority, or both; voting again replaces
their vote, and they can withdraw either part or the whole vote.

**How the average is worked out** (`core/votes.ts`):

- **Points:** the plain average of the points votes, rounded to the nearest
  whole number, with a half rounding up (4 and 5 make 5).
- **Priority:** each word counts as a number (urgent 4, high 3, normal 2,
  low 1), the average is rounded the same way, and turned back into a word.
  High and Low make Normal; High and Normal make High. (This counting rule was
  the spec's proposal; Dane answered the ticket without changing it.)
- A part nobody has voted on keeps the owner's own value.
- **A done task's points stay locked.** Votes on a done task are kept and
  shown, but they do not change it.

**The database applies the average**, in the same save as the vote: a
member voting on someone else's task may not change that task themselves.
It follows exactly the rule in `core/votes.ts`. Each vote cast, changed or
withdrawn is also an engagement for the voter (`voted_on_task`, 1 point).

Row-level security was on from the moment `task_votes` was made. Every
signed-in member reads every vote; a member adds, changes and withdraws only
their own. Signed-out visitors see nothing.

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

### A member's profile

Each member has a profile page, `/profile`: a display name, an avatar, a
short bio and who may see them. It follows WaveCenter's privacy promise
(https://wavecenter.com/privacy-and-security-first/): a profile starts
**completely anonymous**, and a member reveals more only when they choose
to. It lives in `member_profiles`, one row per member:

| Column | What it holds |
|---|---|
| `owner_id` | The member the profile belongs to. |
| `display_name` | The name they go by, up to 50 characters. Empty means none: they are shown by their avatar alone. |
| `avatar` | One of WaveCenter's built-in avatars (wave, sun, moon, star, leaf, mountain, flame, shell). Starts as the wave. No photo uploads yet. |
| `bio` | A short bio, up to 280 characters, or empty. |
| `visibility` | `anonymous` (the start: nobody sees anything but the avatar), `private` (only the member) or `public` (other signed-in members see the name and bio). A member with no row yet counts as anonymous. |
| `tool` | Which tool last changed the row, as on `tasks`. |
| `updated_at` | When it last changed. Kept current automatically. |

There is no page yet that shows one member's profile to another, so today
nobody but the member can read their row, whatever they chose; the choice is
recorded now so that page can honour it when it comes. Masks, Filters and
vendor access from the privacy article are later work.

The profile only changes through `saveProfile` in `core/profiles.ts`, which
checks every field; the database checks the same limits. Row-level security
was on from the moment this table was made: a member reads and changes only
their own row, and a signed-out visitor gets nothing.
`npm run check:tasks-rls` proves it for this table too.

### Roles and permissions

Every member has a role, and each role has a set of permissions (Dane,
2026-10-28; on 2026-10-29 he chose the first slice: stored and shown, and an
admin changes roles). **The task permissions are recorded, not yet
enforced**: what anyone may do on tasks is still the rule under "Who can see
what" below. A later ticket makes them count. **The member permissions do
count** (2026-10-29): `member.read` decides who may list the members, and
`member.edit` decides who gets the buttons on the Members page.

| Table | What it holds |
|---|---|
| `roles` | The five roles, each with a name and a plain-words description: **admin**, **editor**, **contributor**, **reviewer**, **viewer**. |
| `permissions` | What a role may be allowed to do. It starts with **read task**, **create task**, **edit task** and **delete task** (stored as `task.read`, `task.create`, `task.edit`, `task.delete`), plus **view members** and **change member roles** (`member.read`, `member.edit`, added by `20261029210000_member_permissions.sql`), **manage game scoring** (`game.edit`, added by `20261031140000_game_scoring_admin.sql`) and **message members** (`member.message`, added by `20261031150000_messages.sql`). It is meant to grow: a new permission is a new row, added by a migration. |
| `role_permissions` | Which role has which permission. Admin and editor have all four task ones; contributor reads, creates and edits (their own tasks); reviewer and viewer read. Every role views members; only admin changes member roles, manages game scoring and messages members. |
| `member_roles` | Each member's role, with the tool and the admin that last changed it. A member with no row is a **contributor**, which is what every member was before roles existed. Dane's account was made admin when the table was made. |

Every signed-in member can read the first three tables; nobody can change
them from the browser. A member can read their own `member_roles` row; an
admin can read them all. Nobody writes `member_roles` directly: a role
changes only through the database function `set_member_role`, which refuses
anyone who is not an admin, refuses a change that would leave WaveCenter
with no admin, and refuses a change that names no tool. `setMemberRole` in
`core/members.ts` applies the same rules before it asks.

The rules above ask a helper, `private.member_role`, what a member's role
is. It lives in the `private` schema, which the API does not expose, so no
member can call it to look up someone else's role. (It first lived in
`public`, where any signed-in member could call it; the second migration
moved it.)

The **Members** page (`/members`, in the menu for admins only) lists every
member through the function `list_members`, which any role with
`member.read` may call (every role, to start; it was admins only until
2026-10-29). It
shows each member only as their profile allows other members to see them:
their avatar (none if their profile is private) and their name only if
their profile is public. No email address leaves the database. The list has
a filter row (name, role), headings that sort (Member, Joined, Role), and an
Actions column with the buttons the viewer's role may use (`memberActions`
in `core/members.ts`): today, an admin's role picker and Message envelope
(see "Messages to members" below). Adding and removing
members is left out for now (Dane, 2026-10-29). Below the list, a table
shows which role has which permission. A role without `member.read` that
opens the page is told so.

### Messages to members: `messages`

An admin writes to a member from the Members page (Dane, 2026-10-30). Each
message is saved, then emailed to the member through Resend (his choice,
2026-10-30); the email comes from a WaveCenter address and replies go to
Dane's Gmail.

| Column | What it holds |
|---|---|
| `sender_id`, `recipient_id` | Who wrote it and who it is for. |
| `subject`, `body` | The message, plain text: up to 200 and 10,000 characters. |
| `tool` | The tool that sent it (`wavecenter` for the Members page). |
| `email_status` | `pending` until the server reports how the email went: `sent` or `failed`. A failed email still leaves the message saved, and the form says so. |
| `emailed_at`, `created_at` | When it was emailed and when it was written. |

Row-level security was on from the moment the table was made. The sender and
the recipient read a message; **nobody else does**, and nobody writes the
table directly. A message is saved only through the database function
`send_message`, which refuses a role without `member.message`, an empty
subject or message, and a message that names no tool; `sendMessage` in
`core/messages.ts` applies the same rules first. `send_message` hands the
recipient's email address back to the server so it can email them; it never
goes to the browser, and every address read leaves a saved message behind.
The email result is recorded only through `record_message_email`, by the
sender, once. There is no screen for reading messages yet (a later ticket).

### Teams: `teams` and `team_members`

A team is a named group of members (Dane, 2026-10-30). Every role may view
the teams (`team.read`, **View teams**); admins and editors make, change and
delete them and change who is on them (`team.edit`, **Manage teams**; Dane
chose "B" on 2026-10-30).

| Table | What it holds |
|---|---|
| `teams` | One row per team: `name` (up to 80 characters), `slug` (the team's short web-address name: lowercase letters, digits and single hyphens, up to 60, **unique**), `description` (optional, up to 500), the `tool` that last changed it, who made it (`created_by`, stamped by the database) and when. |
| `team_members` | Which member is on which team, with the tool and the member who added them and when. Deleting a team removes its rows here and never a member account; deleting a member account removes theirs. |

Row-level security was on from the moment both tables were made. Any role
with `team.read` reads them; only a role with `team.edit` adds, changes or
deletes a row. The check asks a helper, `private.may`, which, like
`private.member_role`, the API does not expose. Every change goes through
`core/teams.ts` (`createTeam`, `updateTeam`, `deleteTeam`, `addTeamMember`,
`removeTeamMember`), which applies the same rules first, checks the slug, and
names the tool.

The **Team Manager** page (`/teams`, "Teams" in the menu) lists the teams and,
for each one, its members through the function `list_team_members`. Like
`list_members`, it shows each member only as their profile allows: their
avatar unless their profile is private, and their name only if it is public.
No email address leaves the database. `npm run check:tasks-rls` proves all of
this, on the test database for an unmerged change (`npm run db:test`).

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
| `comment_id` | The Discussion comment it is attached to, or empty for a file on the task itself. If the comment is removed, the row goes with it. |
| `created_at` | When it was attached. |

Files only change through `core/files.ts`: `attachFile`, `removeFile`,
`removeCommentWithFiles` and `deleteTaskWithFiles`. They keep the two halves in step. A record is only
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
bucket has its own rules: every signed-in member can see and open every
file attached to a task (since 2026-10-27), but a member adds and deletes only
their own files, only in their own folder, and only on their own tasks.

A file can also be attached to a Discussion comment (Dane, 2026-10-27:
"allow links and attachments"). Its stored copy sits in the task's comments
folder, `<owner id>/<task id>/comments/<random id>-<file name>`, and its row
names the comment. It shows under the comment, not in the task's own file
list. It is as private as the comment: only whoever can see the comment can
see its row or open its stored copy, which today means only its author. A
file can be attached only to the member's own comment, on the same task.
Removing the comment, or deleting the task, deletes its files' stored copies
too, not just the rows.

### A task's Discussion: `task_comments`

Every task has a Discussion: a thread of comments, oldest first, where the
story of the task is told (Dane, 2026-10-27). For now it holds only what
people and agents write; changes to the task are not added to it
automatically (Dane chose that). One row is one comment:

| Column | What it holds |
|---|---|
| `id` | The comment's permanent identifier. |
| `task_id` | The task it is about. If the task is deleted, its comments go with it. |
| `owner_id` | The member it belongs to. Filled in automatically. |
| `body` | What it says, as plain words in a small rich-text format: `**bold**`, `*italic*`, lines starting `- ` or `1. ` for lists, and `[words](https://…)` links (core/richText.ts). Never blank, at most 10,000 characters. It is never treated as HTML, and a link only works for http:, https: or mailto:, so nothing typed into a comment can run in the browser. |
| `tool` | Which tool wrote it, or last edited it. |
| `created_at` | When it was posted. |
| `updated_at` | When it was last edited. Kept up to date automatically. |

A comment written through WaveCenter's own screens (the tool `wavecenter`)
counts as **Human**; one written through any other tool counts as **AI**.
That rule lives in one place, `commentAuthorKind` in `core/comments.ts`, so
the screen and any future agent path agree. Comments only change through
`core/comments.ts`: `addComment`, `editComment` and `removeComment`. An edit
can change only the words (and the tool that changed them): a comment never
moves to another task or another author. Comments earn no points yet.

Row-level security was on from the moment `task_comments` was made: a member
reads, adds, edits and deletes only their own comments, and adds them only to
their own tasks.

### Who can see what

Row-level security (the database's own rule about which rows each person may
touch) was turned on in the same step that created the table, so there was
never a moment without it. **Every signed-in member can read every task**,
open and done, with its details and files (Dane, 2026-10-27: "All users will
have access to the entire todo list — past, present, and future"). A member
can add, change and delete **only their own** tasks, and cannot add a task in
someone else's name or hang a sub-task under someone else's task. On anyone's
task they can vote. A visitor who is not signed in gets nothing at all.

The server holds one key (the "service role" key) that can see everything. It
never goes to the browser.

This is proved, not assumed: `npm run check:tasks-rls` makes two throwaway
members, has each write a task, checks that each can read the other's but
neither can change or delete it (tasks, settings and attached files alike),
that neither can read, change or delete the other's Discussion comments or
the files attached to them, that
each votes only through their own vote and the average lands on the task,
that only an admin lists members or changes a role, that only an admin
sends a message and only its sender and recipient read it, and
then deletes them both along with their files.

## The game layer: `game_scoring_rules` and `engagements`

Dane, 2026-10-27: "nothing happens within WaveCenter that isn't tracked and
scored." This is the first piece of that, modelled on Normie's game layer.

- **`game_scoring_rules`** is the list of kinds of engagement and what each
  is worth: made a task, changed a task, finished a task, deleted a task,
  attached a file, removed a file, handed a task to AI agents, switched AI
  agents on or off, changed your profile, voted on a task. Each has a name, a
  description, exactly what counts, and its points. Every kind is worth 1 point except finishing a task, worth 5.
  An admin changes them on the Game management screen (below); a members'
  vote comes later. Each rule also records which tool and which member last
  changed it.
- **`engagements`** is the ledger: one row for every thing a member does,
  saying who is credited, which kind it was, the points it earned, the tool
  that did it and the task it was about, with the time. The points are copied
  from the rule at that moment, so changing a rule later never rewrites what
  someone already earned. A row about a deleted task stays.

**The database writes the ledger itself.** Every time a task, an attached
file, the AI agents switch or a profile is saved, the database records the engagement
in the same step as the save. The two go through together or not at all: if
the engagement cannot be written, the save fails and the screen says so. No
tool, and no page, can choose how many points something is worth, and a
change that somehow went around core is still recorded. The rules for which
kind a change is live in `core/game.ts`, and the database follows the same
rules. A change the database makes on its own while doing something else
(letting go of a deleted task's sub-tasks, removing a deleted task's files)
is part of that one engagement, not extra ones.

**Who can see what.** Every signed-in member can read the scoring rules. A
member can read **only their own** engagements and their own points total.
Nobody can add, change or delete a ledger row through the website or the
API, not even their own; only the database's save step writes there.
Row-level security was on from the moment each table was made.

The `/game` page shows the rules, the member's total and their latest
engagements, with times in Mountain time.

This does not yet change a task's own `points`: what a task is worth and what
a member has earned are kept separate for now. Levels, rewards and a
leaderboard are later tickets (Dane, 2026-10-30: "Hold off on levels and
rewards").

### Who may change the scoring rules

Dane, 2026-10-30: an admin sets what each action is worth, and "if an admin
user adds a score, it is immediately active". Only a role with **manage game
scoring** (`game.edit`; admin only to start) may, on `/game/manage`, linked
from the Game page for admins only.

- **Changing a rule** (its name, description, what counts, and its points)
  goes through `changeScoringRule` in `core/game.ts` and then the database
  function `update_scoring_rule`. Both refuse any other role, points that are
  not a whole number from 0 up, a blank name, and a change that names no tool.
  The new value counts from the very next engagement. Engagements already
  earned keep the points they were given, because each one copied its points
  when it happened.
- **Adding an action** goes through `addScoringRule` and `add_scoring_rule`.
  Dane chose (option B) that admins may add new actions, but a new one is
  **not active**: nothing in WaveCenter records it yet, so it earns nothing
  until an agent wires it to a function, a database trigger and a test. The
  screen marks it "Not active yet". Its kind comes from its name ("Wrote a
  comment" → `wrote_a_comment`), and neither may already be taken.
- **Nobody deletes a rule**, and nobody writes the table directly through the
  API, not even an admin.

Every active action names where it comes from (`SCORING_TRIGGERS` in
`core/game.ts`): the core function that triggers it, the database trigger
that records it, and the test that proves it. The screen shows all three, and
a test fails if any action is missing one or names something that does not
exist.

## Evolution: `evolution_entries`

One row per change merged into `main` (each first-parent commit), with a
screenshot of the screen that change touched, taken as the screen looked at
that moment with the real tasks, members and points of the time (Dane,
2026-10-30). The pictures live in a private file-storage bucket, `evolution`.
Both are written only by `npm run evolution` (`scripts/evolution_capture.mjs`)
on the Mac Mini, with the service key; that script's header says how it
rebuilds "the data as it stood" and what it cannot show.

| Column | What it holds |
|---|---|
| `commit_sha` | The change's full commit id on `main`. One row per change. |
| `merged_at` | When it merged. |
| `pr_number` | Its pull request number, if it had one (the first commit did not). |
| `title` | The pull request's title, which is the ticket's name, word for word. |
| `ticket_url` | The ClickUp ticket the pull request links to, if it named one. |
| `page` | The address photographed, such as `/game`. Empty for a change with no screen. |
| `screenshot_path` | The picture's name in the `evolution` bucket. Set only when the picture is stored. |
| `capture_state` | `captured` (picture stored), `no screen` (the change touched no page; a text-only entry, not a failure) or `failed`. |
| `failure_reason` | Why a `failed` change has no picture, in plain words (for example, that change would not build). |
| `captured_at` | When the row was last written. |

The table refuses a `captured` row without its stored picture and a `failed`
row without a reason (engineering rule 6). Row-level security is on from the
migration that made the table: signed-in members read every row and every
picture; signed-out visitors read nothing; nobody adds, changes or deletes
either from the browser. `check:tasks-rls` proves each of those.

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

Votes are a plain average "for now". Weighting a vote by tokens and
reputation (above) is a later change to how the average is worked out, not
to the votes table.
