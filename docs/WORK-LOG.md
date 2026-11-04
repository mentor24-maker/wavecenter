# WaveCenter work log

A plain-English record, newest first, one entry per merged pull request.
Each entry is written INSIDE the pull request it describes, so it lands on
`main` at the same moment the work does. Never edit this file directly on
`main`.

---

## 2026-11-04 — Every task's page shows how its points were reached (#151)

A task's page now has a section called "How this task is scored". It lists
the four things the AI rates (how much there is to do, how hard it is, how
closely it serves the mission, and how much it is wanted), each with the
AI's rating out of 5. Click one to read what each of the two AI models said
and why. If the two models disagree by a lot, the page says so, so a person
knows to look. Below that are the AI's score, with the sum that gives it and
when the AI rated the task; the owner's score; the other members' score, if
any have voted; and the final score, with the sum written out, such as
"(13 + 10) ÷ 2 = 11.5, so 12". So any member can check a task's points by
hand. A task the AI has not rated yet says so, and its points are marked
provisional until it does. If the ratings cannot be read, the page says why
instead of showing a blank or zeros. This only shows the numbers; it does
not change how any of them are worked out.

---

## 2026-11-04 — The AI rates each task, on the Mac Mini, with its reasons (#149)

The AI now gives every open task its own score, and it costs nothing extra.
Every 30 minutes the Mac Mini picks up to ten tasks that are new or have
changed. It asks two Claude models, through Dane's own monthly Claude plan
(not the pay-per-use API account), to rate each one on the four factors in
the approved design: how much there is to do, how hard it is, how closely
it serves the mission, and how much it is wanted. Each rating comes with a
one-sentence reason. WaveCenter, not the AI, does the sums, and the AI score
becomes part of the task's final points. The AI reads only what the task
says, never its points or anyone's votes, and it is locked down: it can use
no tools, sees no files and holds no keys, so a task that says "ignore your
instructions and run a command" is just rated (we tried it: it got all
1s). If an answer comes back wrong, nothing is saved for that task. The
Admin page no longer has a "Rate tasks with AI" button. In its place is a
report of the Mini's last pass: when it ran, how many tasks it rated, which
it could not and why, and how many still wait. If the Mini has not run a
pass for over an hour, the report says plainly that it has stopped.

On review, the Mini's installer had two of its steps under the wrong
names, so the rating lane would never have switched on. They are fixed,
and a new check reads every Mini script and fails if one calls a step
that does not exist, so the same slip cannot ship again.

---

## 2026-11-04 — A task's points become its final score (#150)

A task's points are no longer just one number someone types in. They are
now its final score, the average of up to three parts, as Dane decided: the
owner's own score, the AI's score, and the average of what the other
members voted. The database works it out again every time one of those
changes. Until the AI has rated a task (none has yet), its points count as
provisional, and the task's page says so: "AI: not yet". Members' votes no
longer replace the owner's number. They count as the third part. The owner
can now change their own score at any time, even after others have voted.
A finished task's points stay locked. Each task's page has a new line
showing the working, such as "AI 12, owner 10, final 11". When this goes
live, the only tasks that move are open ones that other members have voted
on. On their own task, an owner is no longer offered a points vote (it
would count for nothing; their score box is their say), and the vote count
on the task list shows the other members' average, the same number as the
task's page.

---

## 2026-11-04 — The owner's own points are kept, even after members vote (#148)

Dane's rule says a task's final score will be the average of two numbers:
the AI's score and the owner's score, the points the person who made the
task gives it. Until now the owner's number did not survive: once members
voted, their average overwrote it. Each task now keeps the owner's score in
a place of its own. When the owner sets a task's points it follows along;
a member's vote never touches it; and nobody can type it in directly, the
database keeps it itself. Following Dane's answers ("7A, 8A"), tasks that
already existed got their points as they stand today, and a task at 0
points counts as "not set", since most of those owners simply never gave a
number. Nothing on screen changes and no task's points move; the next step
uses this number to work out the final score.

---

## 2026-11-03 — A home for the AI's ratings of each task (#147)

The approved design says the AI will rate every task on four things, each
from 1 to 5: how much there is to do, how hard it is, how closely it serves
the mission, and how much it is wanted. This builds the place those ratings
are kept, before any AI is switched on. The rules live in WaveCenter's core:
the four factors with the test for each level, a refusal for any rating that
is missing or off the scale, a reason required for every rating, and the
formula that turns the four into the task's AI score, from 1 to 50. Two AI
models rate each task separately, so the database keeps each rating round
as one whole record: both models' ratings and reasons, the average of the
two, the AI score that average makes, and a fingerprint of what the AI read,
so anyone can tell later whether the task changed since. Every round ever
made is kept and none can be edited or deleted, so anyone can look back at
how a task was judged. Every member can read them; only WaveCenter's own
server can add one. The database works out the score itself and refuses one
the formula did not produce, so the AI can never make up its own number.
Nothing on screen changes and no task's points move yet.

---

## 2026-11-03 — Admins can make a DEO's points final, for good (#145)

While a DEO's point values are still guesswork, an admin can rescore
points members already earned. Once the values settle, that power should
end, so members can trust their points stay earned. The Admin page now has
a "Scoring phase" section: it says whether scoring is provisional, and an
admin can click "Make points final". A warning says this cannot be undone,
and the admin must type FINAL to confirm. After that, rescoring is switched
off, and the page says when points became final and who did it. Dane chose
"Permanent", so the database itself refuses any attempt to switch back,
even with the master key. If it ever had to be reopened, an agent session
would write a migration on Dane's written word. Every member's Game page
now says whether points are provisional or final. One gap the review
caught: if the admin who made points final later deleted their account,
the record kept pointing at an account that no longer existed, and the
lock stopped anyone fixing it. Now that one case clears the name and
nothing else, and the screen says "an admin whose account is gone".

---

## 2026-11-03 — A written design for how tasks are rated (#146)

Before any code, this writes down how a task's worth will be worked out,
for Dane to approve. The AI rates each task on four things, each from 1 to
5: how much there is to do, how hard it is, how closely it serves the
mission, and how much it is wanted. Each level has a one-line test anyone
can check. A simple formula turns the four ratings into one number of
points, from 1 to 50, the same range owners use today. The task's final
points are the average of that number and the owner's own points, as Dane
decided; later the other members' average joins as a third part. Four
real tasks are worked through as examples. The design also says how the
AI is kept honest: it runs on the server, two models rate every task, every
reason is kept for anyone to read, and an admin can overrule it. Eight
questions are left for Dane, such as what happens to today's votes in the
meantime. The scoring plan and wiki now follow his rule. Nothing is built
yet.

---

## 2026-11-03 — Globular scoring planned as six tickets (#144)

Dane asked for a second kind of score, globular: what a task is worth,
judged on a set of factors such as scope, difficulty, relevance and
demand, each on a small scale. This ticket was the plan, not the build.
Dane then settled the key rule: the AI rates the factors, and that is
the task's AI score; the owner's own points are the human score; the
task's final score is the average of the two. Later, the average of the
other members' scores joins as a third part. The six tickets follow that
rule, in order. First a written design for Dane to approve: the
factors, the scale, the formula and how the AI rates; nothing else is
built until he approves it. Then a place in the database for the AI's
ratings and reasons, keeping the owner's points safe from being
overwritten by votes, the step where the final score becomes the task's
points, the AI rating tasks on the server (which needs an AI service key
from Dane), and the task page showing the AI's ratings beside the
owner's score. Two earlier tickets that had members rating factors were
closed. Their tasks were ticked for AI agents again and filed a second
time; Dane answered "A" on both (close them), and added that the AI uses
the factors to reach one point value, and that value is what is averaged
with the human scores.

---

## 2026-11-03 — The token now plays when a member earns points (#143)

Until now the spinning token only played from the Preview button on
Game → Manage. Now it plays for real: the next time a member opens any
page after earning points, one token floats up into their header total
for each thing they earned, oldest first, sized by what it was worth, and
the total counts up to the true figure. Dane chose "next page load"
rather than live. The member's own browser remembers the last earning it
showed, so a reload plays nothing new, a first visit on a new browser does
not replay their whole history, and a busy day plays at most five tokens.
If the earnings cannot be read, nothing plays and the plain total shows.

---

## 2026-11-03 — Admins can rescore past points while scoring is provisional (#142)

Early on, nobody knows what each action is worth, so the first points were
guesswork: most actions at 1, some cut by the old farm-risk weight. The
Admin page now has **Rescore past points**. It brings every member's past
points for an action up (or down) to what the action is worth today. Preview
shows what would change, action by action and member by member, before
anything is saved. Nothing already in anyone's history is rewritten: the
rescore adds one correction line per member and action, which My Points
shows as "Rescored Made a task". Running it twice in a row changes nothing.
It only works while scoring is still provisional. Once Dane declares a DEO's
points final (a separate ticket), the database refuses it for good.
An action still counts as needing a rescore when one member is owed points
and another was over-credited by the same amount, even though the action's
total looks unchanged. A large DEO's preview reads every member, not just
the first thousand rows.

## 2026-11-03 — The spinning token disc and its Preview button (#141)

Dane pictured a small coloured disc spinning up into a member's point
total whenever they earn points. That animation now exists. The disc's
size and colour come from the token sizes set on Game → Manage. It
spins like a tossed coin as it floats up to the total in the header,
and when it lands the number counts up. Each size on Game → Manage now
has a Preview button, so an admin can watch it at that size and colour.
A preview changes nobody's points: the number goes back after a moment.
For members who have asked their device to reduce motion, there is no
disc; the number just changes. It does not yet play when real points are
earned. That is the next ticket.

## 2026-11-03 — Your point total in the header on every page (#139)

Until now a member could see their points only on My Points. The header
now shows the total on every page, between the member's name and Log out
("Dane · 1,234 points | Log out"), and clicking it opens My Points. This
is the first step of the token animation: the spinning discs Dane asked
for need a total in the header to float up to. If the total cannot be
read, the header says "points unavailable" (hover for the reason) rather
than showing a misleading 0. On a phone a long name shortens with "…" so
the points and Log out stay on screen.

## 2026-11-03 — Token animations planned as four tickets (#138)

Dane asked for a small coloured disc to spin up into a member's point
total in the header whenever they earn points, with admins choosing the
discs' sizes, colours and the point levels for each size. This ticket was
the plan, not the build: it split the work into four tickets now waiting
in the queue, in order. First the point total goes in the header (today
it is only on My Points). Then a Tokens section on Game → Manage for the
sizes and colours. Then the spinning disc itself, with a Preview button.
Last, playing it the next time a page loads after points are earned, as
Dane chose. Each ticket has its own task on Dane's list. No code changed.

## 2026-11-03 — Token settings on Game Manage: sizes, colours and point levels (#140)

Game → Manage has a new Tokens section. A token is the small coloured disc
that will soon float up to a member's point total when they earn points.
Admins can now set how many sizes there are, how big each one is, what
colour it is, and how many points it takes to get each size. It starts with
three: Small from 1 point, Medium from 5 and Large from 20. The animation
itself comes in a later ticket. Only an admin can change the sizes, and the
database enforces that as well, so a non-admin cannot get around it. If a
save fails, the page says so and keeps what was typed, for example when two
sizes are given the same point level. If every size is removed, the page
says why the table is empty.

## 2026-11-03 — Proposed and Change columns centred on Recalculate action points (#137)

On Admin → Recalculate action points, the Change column ("1 → 3") was
lined up on the left, so it started right against the Proposed number
next to it and the two could read as one run of characters. The Change
heading and every value under it are now centred, like Proposed, so each
number sits in the middle of its own column. Only this table changed.

## 2026-11-03 — Admins can write the reason behind each factor score (#136)

#134 showed why each action got its Effort, Value, Rarity and Farm-risk
scores, but nobody could change those reasons, and a newly added action
would say "No reason has been written" forever. Now each factor on
Game → Manage has a "why" button. It opens the reason to write or change,
and the Admin page's pop-ups show the new text straight away. A new
action can be given its reasons when it is added. Only admins may change
them, a reason is one short sentence (300 characters at most), and
reasons never change anyone's points.

## 2026-11-03 — Two ways to farm points are closed (#133)

Two loops paid points every time round, and now that Farm risk no longer
takes points away (#131) nothing would hold them back. Finishing a task, reopening it and finishing it again paid "Finished
a task" (5 points) each time. Saving a task, a profile or the AI agents
switch without changing anything still paid a point. Now a task earns its
finish only once; finishing it again counts as an ordinary change, worth 1.
A save that changes nothing earns nothing. Every real action still scores,
as Dane asked. This had to land before other members are invited.

## 2026-11-03 — Click a factor score to see why it was given (#134)

Each action's points come from four scores: Effort, Value, Rarity and Farm
risk. On the Admin page's Recalculate action points table, you could see
those numbers but not the thinking behind them. Each number can now be
clicked (or reached with Tab and opened with Enter). A small pop-up shows
what that level means, plus one sentence on why this action got that
score. All 96 sentences (24 actions, four scores each) are stored with the
actions and written into the scoring document. A test checks the two
match. Dane can now check every score himself before putting new points
live. No score or points value changed.

## 2026-11-03 — A scoring wiki explains how points work (#135)

How WaveCenter scores what members do was spread over several long
documents. There is now one place to start: a small wiki in
`docs/scoring/`, with an index and short pages on the principles (Dane's
two types of score, and his point that scores grow with how complex the
work is), the small automatic points and their formula, the bigger
thought-through values such as what a task is worth, how farming points
is being stopped, a glossary, and a list of open questions for Dane.
Every claim names where it comes from. The index lists the pages still
to write, so it can grow as scoring does.

## 2026-11-02 — Every action scores at least 1 point (#131)

The formula that works out what each small action is worth used to take
"farm risk" (how easily an action can be repeated just for points) away
from the total. Nearly every action had the highest farm risk, so six of
them came out at 0. Dane wanted every action to score something, and felt
farm risk was weighed too heavily. Farm risk is now still scored and kept
for later anti-farming work, but it no longer changes the points. The
lowest an action can score is 1. Finishing a task, the most valuable, now
proposes 11. Nothing goes live until Dane clicks "Put these live" on the
Admin page.

The formula line above the Recalculate action points table (added in
#130) now shows the new formula too.

## 2026-11-02 — The Admin page explains how action points are worked out (#132)

The Recalculate action points panel showed the formula in one dense line
and labelled its columns only E, V, R and F. It now has a "How the formula
works" section that opens on a click: what Effort, Value, Rarity and Farm
risk each mean, how high each can go, how each one raises or lowers the
points, and the plain test for every level. Four worked examples show the
sum step by step, including one where farm risk is high but changes
nothing and one that scores the lowest possible 1. The wording and sums
are read from the same code the formula uses, and a test checks every
example, so the explanation cannot quietly fall out of step with the real
scores. (It follows the formula as #131 left it: farm risk no longer
counts.)

## 2026-11-02 — The Recalculate action points table is readable (#130)

On Admin → Recalculate action points, the Proposed number and the Change
text were printed with no gap, so "3" beside "1 → 3" read as "31 → 3".
Every column in that table now has space around it, and the number columns
are centred. A line above the table now spells out the formula that turns
the four factor scores into the Proposed number, using the same words as
the rule in the code. The other tables on the site look the same as before.

## 2026-11-02 — Evolution cards look harder for Dane's own words (#129)

Dane asked that every Evolution card on Home show his own prompt, not an
agent's summary. 26 cards had none. The tool that fills them now also looks
in the Claude Code chat where a change's ticket was made, as he chose. It
also stops showing a one-word reply ("A", "D", "merge") or an agent's
"your words aren't recorded" as if it were his request, and names each
card it leaves alone. Run once after this merge, it fills 17 cards,
including the first to-do list's "Build the simple to-do list". The other
9 have no words of his on record anywhere on this machine, so they keep
their short statement.

After review, the chat reader was made stricter: the summary Claude Code
writes when a long chat runs out of room no longer counts as Dane's
typing, a chat with no typing can no longer hide his request in another
chat, and a retaken picture keeps the card's own words, so a card is not
retaken over and over.

---

## 2026-11-02 — New welcome words on the Evolution slider (#128)

Dane rewrote the sentence under "Evolution of WaveCenter" on the home page.
It now invites visitors in: "See the evolution of WaveCenter, from the very
first instruction to it’s current version — task by task. Then get busy
helping build WaveCenter yourself!" The line above the pictures that counted
the changes and explained the arrows is gone, so the box opens straight onto
the slider. The slider itself works exactly as before.

## 2026-11-02 — Members can make proposals on a new Proposals page (#127)

Dane wanted a place for ideas that could become tasks once they pass
muster. There is now a **Proposals** link in the menu, just left of Tasks.
It opens a page where every member sees every proposal, adds their own, and
edits or deletes only the ones they made. Dane chose to keep proposals apart
from tasks ("a proposal is really a different animal"), so they have their
own table and can be reshaped later without touching tasks. For now each
proposal looks just like a task: a title, details, status, priority and
points. The database itself stops a member from changing someone else's
proposal, and a test on the private test database proves it. This is the
first step of a series; turning a proposal into a task comes later.

---

## 2026-11-02 — The password reset email looks like WaveCenter (#126)

Dane asked for the "Forgot password" email to look nice instead of
Supabase's plain default. It now opens with the water-drop picture, the
gold-and-aqua rings and the WaveCenter name, all inside a box with a thin
gold border and rounded corners, then a short message and one **Set a new
password** button. Supabase gives every sign-in email one sender name, and
Dane chose to keep it as "WaveCenter" for all of them, the reset included.
A test member on the private test database asked for a reset, opened the
email, clicked the button and set a new password that then worked for
signing in. The live site needs the design pasted in once (step 5 of the
email setup guide); it arrives from noreply@wavecenter.com once the Resend
setup is switched on.

---

## 2026-11-02 — Home's What is a DEO box has Dane's new words (#124)

Dane wrote a one-sentence description of a DEO for the Home page. The What
is a DEO box now shows it ("A DEO transforms human engagement into collective
ownership, intelligence, and economic value through decentralized
collaboration, shared governance, and technology."), and the link under the
box now reads "Learn more about DEOs". If anyone had already saved other words
in that box with the pencil, those saved words still show until they are
replaced the same way; nothing saved was overwritten.

---

## 2026-11-02 — Evolution cards show who made each change and its points (#104)

Each card in the Evolution row on Home now credits the member behind the
change: their avatar, their name if their profile is set to Public, and
the points on the WaveCenter task the change came from. This is the first
place the game layer shows up on a merged change. A member who keeps their
profile Anonymous is shown by their avatar alone; one who chose Private is
not shown at all, just the points, the same as on the Members page (Dane's
choice). Nobody's bio is ever shown. What a card may show of its creator is decided in one
spot, so the permissions settings Dane plans can plug in there later. A card
with no WaveCenter task linked shows no credit, and nothing on it breaks.

---

## 2026-11-02 — Home's first box says what WaveCenter is in 20 words (#125)

Dane asked for a compelling 20-word description in the first box on Home,
and for its link to read "Learn more about WaveCenter". The box is now
headed **What is WaveCenter** (his choice when asked) and reads: "The hub of
the DEO movement: a member-owned collaboration platform where every
contribution is tracked, valued in points, and rewarded." Every phrase comes
from the canon or wavecenter.com, and a test keeps it at exactly 20 words.
No member had saved their own words for the box, so the new ones show
straight away; an admin can still change them with the pencil.

---

## 2026-11-02 — The Admin page can work out every action's points by formula (#113)

Dane wanted the new way of valuing game actions to run as a job he starts
himself, with no AI service. Now each action stores its four scores (effort,
value, rarity and how easily it can be farmed), and the Admin page has a
**Recalculate action points** button. It works out what every action should
be worth and shows that beside what it is worth today, without changing
anything. Only when Dane clicks **Put these live** do the new values save,
and only for the actions that actually change; any that could not save are
named, with the reason. Points members already earned stay as they were.
On Game → Manage, each action now has four dropdowns for its scores, worded
with the plain tests from the document, so a new action can be scored by
hand and the next recalculation picks it up.

---

## 2026-11-02 — Adding a new scoring action on Game Manage earns its point (#122)

"Added a scoring action" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every time an admin adds a new action
in the last row on Game > Manage, that admin earns the point (1 to start).
Actions a database update adds behind the scenes earn nobody anything. The
database writes the point in the same save as the new action, so an action
cannot be added without its point, or the point land without the action.
Game > Manage now shows it as Active, naming the function, the database step
and the test that prove it.

---

## 2026-11-02 — Changing a scoring rule on Game Manage earns its point (#121)

"Changed a scoring rule" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every time an admin saves a change to
an action's name, description, criteria or points on Game > Manage, that
admin earns the point (1 to start). Pressing Enter without changing anything
earns nothing. The database writes the point in the same save as the change,
so a rule cannot change without its point, or the point land without the
change. Game > Manage now shows the action as Active, naming the function,
the database step and the test that prove it.

---

## 2026-11-02 — Joining WaveCenter earns the new member their first point (#120)

"Joined WaveCenter" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every new account earns its new
member their first point (1 to start) the moment the account is made.
The database writes the point in the same save as the account, so one
cannot happen without the other. The point names where the account came
from: the Register page, or "supabase-auth" for an account an admin made
another way. Game > Manage now shows the action as Active, naming the
function, the database step and the test that prove it.

---

## 2026-11-02 — Approving a proposed task earns the approving admin a point (#119)

"Approved a proposed task" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every time an admin approves a task a
member proposed, the admin who approved it earns the point (1 to start). The
database writes the point in the same save as the approval, so a task cannot
be approved without its point, or the point given without the approval. The
member who proposed the task still gets their usual point for the task
changing, as before. Game > Manage now shows the action as Active, naming
the function, the database step and the test that prove it.

---

## 2026-11-02 — Changing a member's role earns its point (#118)

"Changed a member's role" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every time an admin gives a member a
different role on the Members page, the admin earns the point (1 to start),
never the member whose role changed. Saving the role a member already has
is not a change and earns nothing. The database writes the point in the
same save as the role, so one cannot happen without the other. Game >
Manage now shows the action as Active, naming the function, the database
step and the test that prove it.

---

## 2026-11-02 — Removing a member from a team earns its point (#117)

"Removed a member from a team" was on the Game > Manage list but marked
"Not active yet", so doing it earned nothing. Now, each time an admin or
editor takes someone off a team, the person who removed them gets the
action's point (1 for now). The member who was removed gets nothing. When a
whole team is deleted, its members go with it, but that does not count as
removing each of them. The point is saved together with the removal, so if
the point cannot be written the member stays on the team and the screen
says it did not work. The test database caught one trap along the way: the
rule other scoring actions use to spot a team being deleted does not work
here, so this one checks whether the team still exists instead.

---

## 2026-11-02 — Adding a member to a team earns its point (#116)

"Added a member to a team" was on the list of scoring actions, but nothing
recorded it, so it earned nothing. Now every time a member is put on a
team, the member who did the adding earns the point (1 to start), never
the member who was added. The database writes the point in the same save
as the team change, so a team change cannot happen without its point, or
the point without the change. Game > Manage now shows the action as
Active, naming the function, the database step and the test that prove it.

---

## 2026-11-02 — Deleting a team earns its point (#115)

"Deleted a team" was on the list of actions on Game > Manage but marked
"Not active yet", so deleting a team earned nothing. Now, when an admin or
editor deletes a team, the member who did the deleting gets the points the
rule says (1 for now, until the points algorithm decides). The database
records it in the same step as the delete, so the team cannot vanish without
the point or the other way round. The team's member list goes with it, and
that is not counted as removing members. Game > Manage now shows the action
as Active.

---

## 2026-11-02 — Changing a team's name or details earns its point (#114)

"Changed a team" was on the Game > Manage list but did nothing yet. Now,
when a member saves a change to a team's name, short web name or
description, they earn the point the rule sets (1 for now). The database
records that point in the same save as the change, so you can't get one
without the other. Saving a team without changing anything earns nothing,
and a change that fails earns nothing and still says it failed. The Manage
screen now shows the action as Active and names the code and the test
behind it.

---

## 2026-11-02 — Making a team on the Teams page earns its point (#112)

"Made a team" was already on the Game Manager's list, but marked "Not
active yet": nothing noticed when a member made a team, so it earned
nothing. Now the database notices every new team and gives the member who
made it the point the rule says (1 to start), in the same save, so a team
and its point always land together or not at all. Changing or deleting a
team, or changing who is on it, still earns nothing (each has its own
ticket), and teams made before this went live are not scored backwards.
Game > Manage now shows the action as Active, with the function, database
trigger and test that record it.

---

## 2026-11-02 — Sending a message to another member earns its points (#111)

"Send a message to another member" was already on the Game Manager's list
of actions, but nothing recorded it, so sending a message earned nothing.
Now, every time a message is saved for another member, the database credits
the sender with the points the Game Manager says it is worth (20 on the live
site today), in the same step as saving the message. A message that is
refused saves nothing and earns nothing, and a note to yourself earns
nothing, so nobody can collect points by writing to themselves. The Game
Manager now shows the action as Active, and names the code and the test that
prove it works.

---

## 2026-11-02 — Deleting your comment on a task earns its point (#110)

"Deleted a comment" was on the Game Manager's list of actions but marked
"Not active yet", so deleting a comment earned nothing. Now it is wired: each
time a member deletes one of their own comments, the database gives them the
point the rule says (1 for now), in the same step as the delete, so one can
never happen without the other. A comment that disappears only because its
whole task was deleted earns nothing extra, because deleting the task was
the action and it is already scored. Tests prove both, in memory and on the
private test database, and Game > Manage now shows the action as Active.

---

## 2026-11-02 — Editing your comment on a task earns its point (#109)

"Edited a comment" was on the Game → Manage list but marked "Not active
yet", so editing a comment earned nothing. Now, each time a member saves a
change to the words of one of their comments, they earn the points the
rule says (1 for now; an admin can change it on Game → Manage). Saving a
comment without changing its words earns nothing. The point is recorded
inside the same save as the edit, so if it cannot be recorded, the edit is
not saved either, and the screen says so. Tests prove one point per edit,
for the right member, both in the core and on the test database.

---

## 2026-11-02 — Posting a comment on a task earns its point (#108)

"Posted a comment" was already on the Game Manager's list, but marked "Not
active yet": nothing noticed when a member posted a comment, so it earned
nothing. Now the database notices every new comment and gives its writer
the point the rule says (1 to start), in the same save, so a comment and
its point always land together or not at all. Editing or deleting a comment
still earns nothing (each has its own ticket), and comments posted before
this went live are not scored backwards. Game > Manage now shows the action
as Active, with the function, database trigger and test that record it.

---

## 2026-11-02 — Every change Dane asks for in a chat starts as his WaveCenter task (#107)

Until now, when Dane asked for a change in a Claude Code chat, it went
straight to a ClickUp ticket, with nothing on his WaveCenter list behind it,
so its Evolution card could not say who asked or what it was worth. 43 of
the first 95 cards came that way. Now the agent makes the WaveCenter task
first, owned by Dane, with his own words in it, then files the ticket from
it and links the two. The task is only marked as "with the AI agents" once
the ticket is safely linked, in a single step, so the lane that turns his
ticked tasks into tickets can never file the same work twice. When the
change goes live, the task is marked done on its own. The picture-taking
run on the Mac Mini now also calls out, by name, any change that still has
no WaveCenter task behind it, so a gap is seen instead of silent.

---

## 2026-11-02 — An admin edits the words in two Home boxes from Home itself (#105)

The words in Home's About WaveCenter and What is a DEO boxes used to be
written into the code, so changing them took a programmer. Now an admin
sees a small pencil in the lower right of each of those two boxes; it opens
the same editor used for task comments, already holding the words, and
saving shows the new words to every member. Dane chose to start with just
those two boxes, since the others show lists WaveCenter fills in itself. A
new permission, Edit Home boxes, decides who gets the pencil: admins only to
start, and it can be given to other roles later. The database itself refuses
anyone without it, and a test proves that.

---

## 2026-11-02 — A written way to value each game action, for Dane to approve (#103)

Almost every action in the game layer was worth 1 point, so flipping the AI
agents switch on and off earned as much as attaching a file, and saving the
same thing over and over earned a point every time. Dane split the game's
scores into two types. **Granular** scores are for small automatic actions.
**Globular** scores are for things that need thought to value, such as what
a task is worth. That split is now written where every session reads it.

A new document gives a simple, checkable way to value each granular action.
Each action is scored on four things: how much effort it takes, how much it
helps the project (this counts double), how rare it is, and how easily it
could be repeated just to collect points. A short formula turns those
scores into points. The document applies the formula to all 24 actions on
the list and gives a reason for each. For example, finishing a task would
go from 5 to 7 points, making a task from 1 to 3, and flipping the switch
from 1 to 0. Nothing changes until Dane approves the numbers. This is the
first slice: next comes a batch job Dane starts from the Admin page, which
works the formula out for every action and puts the values live when he
accepts them, with no AI service needed.

---

## 2026-11-02 — Every old Evolution card gets a WaveCenter task, owned by Dane (#106)

Each Evolution card is meant to have a WaveCenter task behind it, so it can
show who it credits and what it is worth. About 45 of the old cards came
from chat requests or the founding commits and had none. The database now
records which task each card belongs to, and a one-off script fills it in:
a card that came from a WaveCenter task is linked to that task, and every
other card is given a finished task owned by Dane, worth 0 points for now,
dated when its change merged, with his words in its notes where the card
has them. Making those tasks hands out no points, because nobody did new
work today. The script can be run again safely (it skips cards that already
have a task), and a practice mode shows what it would do without writing
anything. Old Evolution pictures leave these tasks out, since they did not
exist back then. The script runs on the live data once this change merges.

---

## 2026-11-01 — The Evolution row opens on the oldest change (#102)

The Evolution of WaveCenter row on Home used to open at its right end, on
the newest change, so reading the story from the start meant scrolling all
the way back. Now it opens at the left end, on the very first change (the
placeholder page from October 11), and the right arrow walks forward
through WaveCenter's history. Nothing else about the row changed.

---

## 2026-11-01 — Every member's message is emailed, and nobody sees anyone's address (#99)

Until now only an admin's message went to the recipient's inbox. A member's
message was saved and shown in WaveCenter, but not emailed, because the old
way of emailing handed the recipient's address back to whoever sent it, and
any member could have used that to collect everyone's addresses. Now the
WaveCenter server looks the address up itself, with its own private key
that never leaves the server, and sends the email. No member, an admin
included, is ever handed an address. A test proves that only the server's
key can look an address up, and only for a message the sender just sent.
Emails still go out only once the email service key is added (see the
email setup guide).

After review, Dane chose (his "A") how the email reads: it names who wrote
it ("Message from Kim Lee"), and clicking Reply goes nowhere; it says to
answer on Your profile in WaveCenter instead. So a member's message no
longer looks like it came from Dane, replies no longer land in his Gmail,
and nobody's address is shown. A sender who keeps their profile private is
named "An anonymous WaveCenter member". Each member can have at most 20
messages emailed an hour, so nobody can use WaveCenter to flood inboxes.
After a second review, that limit counts every message the member sent in
the hour, not only the ones already emailed, so firing many messages at
the same moment cannot slip past it (a test proves it with 30 at once).
The Members page now says a message is emailed only when email is
actually set up on that copy of WaveCenter.

---

## 2026-11-01 — Game → Manage lists every action a member can take (#101)

Game → Manage listed only the ten actions that already earn points.
WaveCenter has grown since then: comments, messages, teams, roles and
approving tasks were not on the list. We went through every screen and
added the 14 missing actions, each worth 1 point. Each one is marked "Not
active yet", so it earns nothing until it is connected to the scoring.
Connecting each action is now its own task in the queue. One action,
"Send a message to another member", had already been added by hand on the
live site. It keeps its 20 points and is not listed twice. Signing in and
out are left off, because they are not contributions.

---

## 2026-11-01 — The Game Manager is one table you edit in place (#100)

Game → Manage used to show each way of earning points as its own form,
stacked down the page, which was long and hard to scan. Now it is one
table with a row per action. Click a name, a points value, a description
or "what counts" and that cell turns into a box right there. Press Enter
or click away to save, or Escape to undo. Each text cell also has a small
expand button that opens the text in a big pop-up box. The last row of the
table adds a new action. Every save still goes through the same checks as
before, and the screen only says "Saved" once the database has confirmed
it. If a save is refused, what you typed stays put and the screen says why.
As Dane chose, the length limits stay as they are and there is no remove
button.

---

## 2026-11-01 — Dane hears about it when the Mac Mini stops taking Evolution pictures (#97)

For most of a day the Mac Mini could not take Evolution pictures: a piece
it needs (a hidden web browser it uses to photograph each screen) had gone
missing. The merge lane failed 96 times in a row and wrote that only into a
log file on the Mini, so nobody knew, and no new change showed up on the
Home "Evolution of WaveCenter" row. Now the lane counts those failures.
After three in a row for the same reason, it files one ticket with a card
for Dane saying what broke and the one command that fixes it, and it does
not repeat itself. When pictures work again, it adds one "works again"
note to that ticket. Setting up a fresh Mini now installs the hidden
browser too, so this cannot start on a new machine.

---

## 2026-11-01 — Old Evolution cards are retaken by themselves when the picture rules change (#98)

Earlier today a fix to how each Evolution card picks its picture went live,
but every card on Home still showed the old picture, because the step that
retakes old cards only ran when an agent session remembered to run it. Now
the merge lane does it on its own: after each merge it checks whether the
picture rules changed, and if they did it retakes the cards those rules now
picture differently. If the rules did not change it retakes nothing. If a
retake fails, the old cards stay as they were, the lane tries again on the
next pass, and the ticket behind the rules change gets one note when it
fails and one when it works. The check stays quick as the cards pile up,
because it only compares pictures where a retake made two cards neighbours.
If it keeps running out of time without retaking anything, the ticket is
told, the same as a failure; another lane briefly using the test database
just means it waits for the next pass.

---

## 2026-11-01 — A written plan for the scoring guess game (#96)

Dane asked for a plan for scoring every task and game action from a human
score (members' votes averaged with the owner's score), an AI score and a
final score (the average of the two), and for a game where members guess
those scores and are measured by how far off they are (deviance, and their
average, the DQ). The plan, docs/SCORING_GAME_PLAN.md, describes what exists
today, including that the owner's suggested points are overwritten once
members vote, which the new rule needs fixed first. It lays out ten
sub-tasks in the order to build them and eight questions only Dane can
answer, such as exactly how the owner's score and the votes are averaged.
Nothing on any screen changed.

---

## 2026-11-01 — The Home picture is mirrored so the logo sits on the dark side (#95)

Dane's water-drop picture on Home is now flipped left to right. The darker
blue water sits on the left, behind the WaveCenter logo and name, where it
makes them stand out, and the bright gold sunlight is on the right. The
signed-out welcome page and the set-a-new-password page use the same
picture, so they are flipped the same way. Only the picture turns round; no
writing, logo or form is mirrored, and every other page's banner is
unchanged. Dane asked for this so the logo contrasts better.

---

## 2026-11-01 — Ticket names keep Dane's own title (#94)

A ticket made from one of Dane's WaveCenter tasks now keeps his title word
for word, instead of an agent rewriting it into a long sentence. Only a title
over 12 words gets shortened, to 12 or fewer. Any other ticket name is 6-12
plain words. PR titles and Evolution cards copy the ticket name, so they get
shorter too. The ticket-filing script now turns away a name over 12 words
before anything is created, so the rule holds even if an agent forgets it.

---

## 2026-11-01 — Your profile shows your messages and lets every member send one (#93)

Messages members sent each other were saved in WaveCenter, but there was no
screen to read them. Your profile now has a Messaging section beside the
profile form: Messages lists what you sent and received, newest first (click
a subject to read it), and Send Message, folded until clicked, writes to any
member picked from a list. As Dane chose, every member may now send, not only
admins. To protect privacy, a member's message is saved and shown but not
emailed yet: emailing it the old way would have let any member find out other
members' email addresses. An admin's messages are still emailed as before.
The Members page now says the same: only an admin is told their message is
emailed; everyone else is told it is saved for the recipient to read on Your
profile. A member's unemailed message is kept marked "waiting to be emailed"
rather than "email failed", so the follow-up ticket can still email it later.

---

## 2026-11-01 — Home's boxes sit twice as far apart (#92)

The space between the boxes on the signed-in Home page is doubled, both
between boxes side by side and between the rows, so the page has more room
to breathe and more of Dane's water-drop picture shows between them. Nothing
else about the boxes changed, and other pages keep their spacing. Dane asked
for this on Home.

---

## 2026-11-01 — The browser tab shows the gold-and-aqua logo (#91)

The little picture in the browser tab was still the old all-blue rings, so
the tab and the logo at the top of the page did not match. The tab now shows
the same gold rings on aqua as the header logo; it is literally the same
image file. Nothing else on the page changed.

---

## 2026-11-01 — Each Evolution card pictures the screen its change was about (#89)

Every card in the Evolution scroller was showing the same picture, the Home
page, because the files every page shares (the colours, the header) all
counted for Home and drowned out the page a change was really about. The
screenshot taker now picks the page that matters: one the change's title
names, then one it added, then the one it changed most. So the game page
change shows the game page and the profile change shows the profile page.
The same page can show on two cards in a row, so you can watch each page
change over time, but a picture that comes out exactly the same as the one
before is left off. A new retake command re-photographs the old
cards whose page changes, and a retake that fails leaves the old card as it
was.

---

## 2026-11-01 — A step-by-step guide to switch on WaveCenter email (#90)

WaveCenter could already send email through Resend, but it had no key, so
messages from the Members page were saved and never sent, and sign-in links
only reached Dane. A new guide, `docs/EMAIL_SETUP.md`, walks Dane click by
click through switching it on: prove WaveCenter owns `wavecenter.com`, make a
key that can only send email, put it where the app and scripts read it, and
send sign-in links through Resend too, with how to undo that last step if it
misbehaves. Two checks show whether it worked: `npm run doctor` now says
whether the key is in place, and `npm run email:test` sends one test email
and says plainly whether it went. Email now comes from
`noreply@wavecenter.com`, the address Dane chose on the ticket.

---

## 2026-11-01 — The Evolution scroller moves to Home, half as tall again (#87)

The row of screenshots showing how WaveCenter looked after each change now
lives on the signed-in Home page, in a box across the full width below the
others, instead of behind a switch on the Tasks page. Each picture is half
as tall again as before, so the old screens are easier to make out. It
still opens on the newest change, a click still shows a picture full size,
and the arrow keys still step through them. The Tasks page is back to just
the task list, and an old link to the Evolution view now lands on Home's box
instead of nowhere. Dane chose this option on the ticket.

---

## 2026-11-01 — Evolution cards speak in Dane's own words (#85)

Each card in the Evolution scroller now shows what Dane actually asked for,
word for word, with one "See the thread" link to where he asked it: the
WaveCenter task, or the ClickUp ticket. The agent-written ticket names and
the row of PR and ticket links are gone, because Dane found them hard to
follow. Where none of his words were ever written down (mostly the earliest
changes), the card says in a few plain words what changed instead, as he
chose. Changes that never touched a screen no longer appear, so every card
shows something you can see. His words are stored with each change, and
one command on the Mac Mini fills them in for the changes already recorded
without retaking any picture.

---

## 2026-10-31 — Home sits on the water-drop picture (#83)

The signed-in Home page now has the same water-drop picture as the log-in
page behind it, from the very top of the screen to the bottom, header
included. Only the header bar is darkened, exactly as much as it is today;
the rest of the picture shows as it is. The boxes on Home are now like
frosted glass: half see-through, with a tight shadow, rounder corners and a
small icon beside each heading. A plain half-see-through box made the text
too hard to read over the brightest and darkest parts of the picture, so the
picture behind each box is softly blurred and toned, which keeps every word
easy to read in light and dark mode. Other pages are unchanged.

---

## 2026-10-31 — The Set a new password page gets the full-screen picture (#84)

The page a member lands on from a password-reset email showed the water-drop
picture only in the bar across the top, then a plain page underneath. It now
looks like the signed-out home page: the picture fills the whole screen, the
top bar goes see-through over it, and whatever the page has to say (the
new-password form, "saved", or an error) sits on one solid panel in the
middle, so it stays easy to read. On a phone the top bar still fits. No other
page changed, and resetting a password works exactly as before.

---

## 2026-10-31 — The header picture shows its colours again (#82)

The bar across the top of every signed-in page had a dark layer over the
water-drop picture, heavy enough that it looked muddy. That layer is now
about a third lighter, so the deep blues on the left and the gold on the
right come through. To keep your name, Log out and the menu easy to read on
the brighter picture, the shadow behind the white letters is a little
stronger. Nothing else on the page moved.

---

## 2026-10-31 — Your name is now the way to your Profile, and "Sign out" is "Log out" (#81)

The top of every signed-in page is tidier. "Profile" no longer takes up a
spot in the main menu; instead, your name in the top right corner is the
link to your Profile page. Next to it, on the same line, is "Log out"
(it used to say "Sign out" and sat underneath your name), so the corner
reads "Your name | Log out". A very long name is cut short with "…" so
Log out never gets pushed off a phone screen.

---

## 2026-10-31 — Every merge now gets its picture in WaveCenter's history (#79)

The camera from #74 used to run only when someone started it by hand. Now
the merge lane on the Mac Mini runs it after every pass: it looks for any
change on `main` that has no picture yet and takes one, oldest first. If a
pass is skipped or cut off, the next one catches up, so the history has no
gaps. It is capped at six minutes a pass (one picture takes about a minute),
so it never holds up Dane's next `merge`. A picture that cannot be taken
never undoes a merge or moves a ticket: the history records it as failed
with the reason, and the ticket gets one plain comment saying why.

---

## 2026-10-31 — Scroll through how WaveCenter grew: the Evolution view (#80)

The Tasks page now has two views, picked with a small **List | Evolution**
switch beside its heading. The list is unchanged and still comes up first.
**Evolution** is the photo album the camera from #74 fills: a sideways row
of cards, one per change, oldest on the left, opening on the newest. Each
card shows what WaveCenter looked like right after that change, its name,
when it went live (Mountain time), and links to its pull request, its
ClickUp ticket and the WaveCenter task it came from. Click a picture to see
it full size and step backwards or forwards with the arrows, on screen or
on the keyboard (the keyboard arrows keep working even after you have
stepped to the first or last change). The pictures
stay private: each one is handed out through a link that only works for a
signed-in member and expires after an hour. Until the camera has run on the
live site, the view says so instead of showing an empty strip.

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

## 2026-10-31 — Admins can write to a member from the Members page (#69)

Each row on the Members page now has a small envelope for admins. Clicking it
opens a form with a subject and a message. Sending saves the message in
WaveCenter, in a new private messages table that only the sender and the
recipient can read, and then emails it to the member through Resend, the
email service Dane chose. The email comes from a WaveCenter address, and
replies go to Dane's Gmail. The form always says what really happened: sent,
saved but not emailed (and why), or not sent. The member's email address
never leaves the server. Until Dane adds the Resend key, messages still save,
and the form says email is not set up yet.
Closing the form while it is still sending is refused, so the same message
cannot be sent twice by accident, and a subject that is only blank lines is
refused by the database as well as by the form.

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

## 2026-10-30 — New tasks from members who are not admins wait for an admin's approval (#60)

Until now, any member could add a task and it went straight into the work
pile, where it could be ticked off or handed to the AI agents. Now a task
added by anyone who is not an admin starts as Proposed. The member who
added it is told so straight away, under the add form and on the task's own
page. A proposed task cannot be ticked off or sent to the AI agents. An
admin sees an Approve button on it, and one click makes it a normal to-do.
The database enforces the same rule, so nobody can get around it by going
past the website. Admins' own tasks start as to-do, as before. This matters
because Dane, as admin, now decides what actually gets worked on.

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
