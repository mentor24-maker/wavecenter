# How a granular action is valued: an algorithm for Dane to approve

**Status: a proposal.** No point value in WaveCenter changes until Dane
approves it. This document is the **first slice**: the written algorithm
and the values it proposes. The **next slice**, now built, is a batch job
Dane starts from the Admin page, which applies this same formula to every
action and puts the results live only once he accepts them (see "How a
value goes live"). Written 2026-11-01 for the
ticket "Create algorithm to assess value of granular tasks" (WaveCenter task
`bbaf3bba-b65b-4813-b35d-62ba2df9eab8`).

## What Dane asked for

Dane, 2026-11-01:

> First, let's distinguish between two basic types of scores in the game
> layer: granular scores and globular scores. Granular scores are like those
> currently listed in the game layer. They are assigned for tiny, mechanical
> actions that can be discretely identified and tracked. They register
> automatically and don't require any thought on the part of the user.
> Globular scores are the kind like determining the value of a given task.
> [...] For this task, we need an AI-generated algorithm to assess the
> relative values of the granular tasks currently defined in the game layer
> and about to be defined.

The distinction is written down in `docs/DATA_MODEL.md` ("Granular and
globular scores"). This document is only about **granular** scores: the
rows of `game_scoring_rules`, one value per *kind* of action ("voted on a
task" is worth N), not per individual action.

## Dane's answer: a batch job on the Admin page

Asked whether he wanted a written algorithm, the values put live, or an AI
on the server, Dane first chose the server AI (2026-11-01, 9:43 PM MT):

> C. This will need to run each time a new score is created.

and then changed his mind (2026-11-01, 11:40 PM MT):

> I take it back. Let's run this as a batch job that I can kick off from
> the Admin page. If we do that can we avoid the need for API?

So the algorithm here is the rule that batch job runs. Yes, it can avoid an
AI service: the formula below is plain arithmetic, so the job needs no API
key once each action has its four factor scores. The one step that needs
judgment is scoring the factors of a **new** action; Game → Manage asks
the admin who adds it to pick them from the four tables below.

For now, an AI agent (Claude) drafted the algorithm and scored every
action's factors, and Dane approves them. Nothing calls an AI while
WaveCenter runs. In the scoring plan's words (`docs/SCORING_GAME_PLAN.md`, "The same
scoring for game behaviors"), the numbers below are the **AI score** for
each kind of action; the admin's value on Game → Manage is the owner's
score, and members' votes on actions come later.

## Today

Every action is worth 1 point, except finishing a task, worth 5. That makes
switching the AI agents switch on and off worth exactly as much as attaching
a file, and lets anyone earn a point a second by saving the same thing over
and over. The algorithm below fixes the first. The second is left to
anti-farming work of its own (see "Safeguards the formula cannot give").

## The four factors

Each kind of action is given a whole-number score on four factors. Each
level has a plain test, so anyone can score a new kind by hand.

**1. Effort (E), 0 to 3.** How much of the member's time and attention the
action itself takes.

| E | Test |
|---|---|
| 0 | One click or one tick. |
| 1 | A short form or a few words: under a minute. |
| 2 | Writing or choosing that takes several minutes of thought. |
| 3 | The click records hours of work done outside it (finishing a task). |

**2. Value (V), 0 to 3.** What the action does for the project and for
other members. Counted twice in the formula, because it is the reason the
game layer exists: the canon says "every act of engagement [...] is
captured, valued, and accrued to the member who performed it"
(`docs/canon/deo-whitepaper.md`, Abstract).

| V | Test |
|---|---|
| 0 | Nothing for anyone else: a personal setting. |
| 1 | Tidies up, or helps one other member. |
| 2 | Adds something the other members read, use or rely on. |
| 3 | Delivers finished work the project planned. |

**3. Rarity (R), 0 to 2.** How often a member genuinely does it. A rare
action is a bigger moment and should feel like one.

| R | Test |
|---|---|
| 0 | Many times a day. |
| 1 | A few times a week. |
| 2 | A handful of times ever, or once (joining). |

**4. Farm risk (F), 0 to 3.** How easily the action can be repeated just to
collect points. **It is scored, not counted:** every action still gets an F
score, and it is stored, but it does not change the points (see "Why farm
risk is not in the formula"). It is kept for the anti-farming work to come.
The canon names this danger: the valuation repository exists so the
membership can keep "deflating any category being farmed"
(`docs/canon/deo-whitepaper.md`, "Failure Modes and Their Defenses").

| F | Test |
|---|---|
| 0 | Cannot be repeated (once per member), or costs real work every time. |
| 1 | Repeatable, but each time needs something real from someone else. |
| 2 | Repeatable in seconds with no real input, but it cannot undo itself. |
| 3 | Repeatable in seconds **and** it loops: a switch flipped back, a save of the same thing, or an action paired with its own undo (make / delete). |

## The formula

> **Points = 1 + E + 2 × V + R**

Farm risk (F) is scored and stored, but not counted.

- **The 1 is the starting point every recorded action gets**, because
  nothing a member does goes unaccounted (canon, "Engagement and
  Intelligence"). Every action scores at least 1; none scores 0.
- **The lowest possible score is 1 and the highest is 12** (1 + 3 + 6 + 2).
  Finishing a task, at 11, is the only action proposed here above 7. The
  very top is left free on purpose: the canon says "in-person engagement is
  valued at the highest levels of the game layer"
  (`docs/canon/deo-whitepaper.md`, "Trajectory: URL > IRL"), and WaveCenter
  records no in-person action yet.
- **The result is a whole number from 1 up**, which is exactly what Game →
  Manage accepts.

A worked example, voting on a task: E = 1 (a judgment, a few seconds),
V = 2 (other members rely on the result: it sets what the task is worth),
R = 0 (many a day). Points = 1 + 1 + 4 + 0 = **6**. Its F is 3 (a vote can
be cast, changed and withdrawn forever), which is recorded but does not
change the 6.

### Why farm risk is not in the formula

The first version subtracted F, and counted R as 0 whenever F was 3. That
left six actions at 0 points. Dane, 2026-11-02:

> I want a floor of 1 point. Every single action scores something.
> I was wondering if the farming quotient was being over-emphasized,
> resulting in the 0 scores in spite of other values. [...] In time, we
> will be adding more sophisticated anti-farming behavior negative scores.
> So I'm not sure we have the need to lean so hard on the farming factor at
> this point.
> I agree to all three. Drop F at this level.

19 of the 24 actions have F = 3, so F worked as a flat −3 on nearly every
row and barely told actions apart. It also counted twice, because F = 3
also set Rarity to 0. Every one of the six zero rows had F = 3. Without F,
every action scores at least 1 with no separate floor needed.

### Granular points are small on purpose

Dane, 2026-11-02:

> We don't need to nail it at this level. They just need to make sense
> relative to each other.

So the numbers below aim for the right order (finishing a task well above
making one, making one above deleting one), not for exact worth.

## The table

### The ten actions that earn points today (`ENGAGEMENT_KINDS`, `core/game.ts`)

| Action | Now | E | V | R | F | Proposed | Why |
|---|---|---|---|---|---|---|---|
| Made a task | 1 | 1 | 2 | 0 | 3 | **6** | Adds work others can pick up; paired with deleting it, so it loops. |
| Changed a task | 1 | 1 | 1 | 0 | 3 | **4** | Keeps a task accurate; any edit can be changed straight back. |
| Finished a task | 5 | 3 | 3 | 1 | 3 | **11** | Records real finished work; reopening and finishing again loops (see safeguards). |
| Deleted a task | 1 | 0 | 1 | 0 | 3 | **3** | Housekeeping worth having; the undo half of the make-and-delete loop. |
| Attached a file | 1 | 1 | 2 | 0 | 3 | **6** | Gives others the picture or file they need; paired with removing it. |
| Removed a file | 1 | 0 | 1 | 0 | 3 | **3** | Tidies up; the undo half of a loop. |
| Handed a task to AI agents | 1 | 0 | 2 | 1 | 2 | **6** | Puts work into the build queue; once per task, but a task takes seconds to make. |
| Switched AI agents on or off | 1 | 0 | 0 | 0 | 3 | **1** | A personal switch that flips back and forth. |
| Changed your profile | 1 | 1 | 1 | 1 | 3 | **5** | Helps others know who you are; saving the same profile again loops. |
| Voted on a task | 1 | 1 | 2 | 0 | 3 | **6** | Sets what tasks are worth, which others rely on; a vote can be changed forever. |

### The fourteen actions listed but not active yet

These were added by the "Update the complete list of possible actions
members can score points for" ticket (#101,
`supabase/migrations/20261102120000_scoring_actions_sweep.sql`) for the
linked WaveCenter task `8dcc80e0-7b59-4fc6-bf62-dd2c3c5cc89d`. Each shows
"Not active yet" on Game → Manage and earns nothing until it is wired, one
ticket each.

| Action | Now | E | V | R | F | Proposed | Why |
|---|---|---|---|---|---|---|---|
| Posted a comment | 1 | 1 | 2 | 0 | 3 | **6** | Others read it on the task; paired with deleting it. Same as making a task. |
| Edited a comment | 1 | 1 | 1 | 0 | 3 | **4** | Corrects your own words; can be edited back. |
| Deleted a comment | 1 | 0 | 1 | 0 | 3 | **3** | The undo half of a loop. |
| Send a message to another member | 1 | 1 | 1 | 0 | 2 | **4** | Helps one member, not the shared record; each needs words, and there is no undo. |
| Made a team | 1 | 1 | 2 | 1 | 3 | **7** | Gives members a group to work in; paired with deleting it. |
| Changed a team | 1 | 1 | 1 | 0 | 3 | **4** | Keeps a team accurate; can be changed back. |
| Deleted a team | 1 | 0 | 1 | 1 | 3 | **4** | The undo half of a loop. |
| Added a member to a team | 1 | 0 | 2 | 0 | 3 | **5** | Brings a member into shared work; paired with removing them. |
| Removed a member from a team | 1 | 0 | 1 | 0 | 3 | **3** | The undo half of a loop. |
| Changed a member's role | 1 | 1 | 2 | 1 | 3 | **7** | Governance others rely on; a role can be changed straight back. Admin only. |
| Approved a proposed task | 1 | 1 | 2 | 0 | 2 | **6** | Reviews and admits work to the list; each needs a proposal, but one takes seconds. Admin only. |
| Joined WaveCenter | 1 | 1 | 1 | 2 | 1 | **6** | Once per member, and new members are how the project grows; the value comes from what they do next, scored on its own. Accounts are cheap to make (the canon's Sybil failure), so F is 1, not 0. |
| Changed a scoring rule | 1 | 1 | 2 | 1 | 3 | **7** | Sets values every member earns by; can be changed back. Admin only. |
| Added a scoring action | 1 | 1 | 2 | 1 | 2 | **7** | Grows the list of what counts; no rule can be deleted, so it cannot loop, but a new one takes a minute. Admin only. |

### Actions added since, scored by the formula from the start

Each of these was scored by "Scoring an action added later" below in the
pull request that wired it, so its points today ("Now") are already the
formula's.

| Action | Now | E | V | R | F | Proposed | Why |
|---|---|---|---|---|---|---|---|
| Sent a chat message | 4 | 1 | 1 | 0 | 2 | **4** | Helps the other member in the chat, like a message; each needs words, and a chat message cannot be edited or deleted, so it cannot loop. (`supabase/migrations/20261112120000_chats.sql`) |

### Why each factor got its score

The "Why" lines above cover all four factors at once. Below, each action's
factors are taken one at a time: one sentence for each, drafted from the
action's "Why" line and the factor's level test. The same sentences are
stored with the action in `game_scoring_rules` (`effort_reason`,
`value_reason`, `rarity_reason`, `farm_risk_reason`): the first 96 filled by
`supabase/migrations/20261103120000_scoring_factor_reasons.sql`, each later
action's by the migration that wires it; a test keeps the two in step). On the Admin page, clicking a factor's number in
**Recalculate action points** shows its sentence.

| Action | Factor | Score | Reason |
|---|---|---|---|
| Made a task | Effort | 1 | Typing a title and saving it is a short form: under a minute. |
| Made a task | Value | 2 | Adds work the other members can read and pick up. |
| Made a task | Rarity | 0 | Members make tasks many times a day. |
| Made a task | Farm risk | 3 | Paired with deleting it, so make-and-delete loops. |
| Changed a task | Effort | 1 | An edit is a short form or a few words: under a minute. |
| Changed a task | Value | 1 | Keeps a task accurate, which tidies up the list. |
| Changed a task | Rarity | 0 | Tasks are edited many times a day. |
| Changed a task | Farm risk | 3 | Any edit can be changed straight back, so it loops. |
| Finished a task | Effort | 3 | The click records the hours of work done outside it. |
| Finished a task | Value | 3 | Delivers finished work the project planned. |
| Finished a task | Rarity | 1 | A member finishes a task a few times a week, not many times a day. |
| Finished a task | Farm risk | 3 | Reopening the task and finishing it again loops. |
| Deleted a task | Effort | 0 | One click. |
| Deleted a task | Value | 1 | Housekeeping worth having: it tidies up the list. |
| Deleted a task | Rarity | 0 | Tasks can be deleted many times a day. |
| Deleted a task | Farm risk | 3 | The undo half of the make-and-delete loop. |
| Attached a file | Effort | 1 | Choosing a file and saving it takes under a minute. |
| Attached a file | Value | 2 | Gives the other members the picture or file they need. |
| Attached a file | Rarity | 0 | Files can be attached many times a day. |
| Attached a file | Farm risk | 3 | Paired with removing it, so attach-and-remove loops. |
| Removed a file | Effort | 0 | One click. |
| Removed a file | Value | 1 | Tidies up a task. |
| Removed a file | Rarity | 0 | Files can be removed many times a day. |
| Removed a file | Farm risk | 3 | The undo half of the attach-and-remove loop. |
| Handed a task to AI agents | Effort | 0 | One tick; WaveCenter files the ticket itself. |
| Handed a task to AI agents | Value | 2 | Puts work into the build queue, which the other members rely on. |
| Handed a task to AI agents | Rarity | 1 | It happens once per task, a few times a week. |
| Handed a task to AI agents | Farm risk | 2 | Once per task, so it cannot undo itself, but a new task to hand off takes seconds to make. |
| Switched AI agents on or off | Effort | 0 | One click on a switch. |
| Switched AI agents on or off | Value | 0 | A personal setting: it does nothing for anyone else. |
| Switched AI agents on or off | Rarity | 0 | The switch can be flipped many times a day. |
| Switched AI agents on or off | Farm risk | 3 | A switch that flips back and forth, so it loops. |
| Changed your profile | Effort | 1 | A few words in a short form: under a minute. |
| Changed your profile | Value | 1 | Helps the other members know who you are. |
| Changed your profile | Rarity | 1 | A member changes their profile a few times a week at most. |
| Changed your profile | Farm risk | 3 | Saving the same profile again loops. |
| Voted on a task | Effort | 1 | A quick judgment in a short form: under a minute. |
| Voted on a task | Value | 2 | Sets what tasks are worth, which the other members rely on. |
| Voted on a task | Rarity | 0 | Members vote many times a day. |
| Voted on a task | Farm risk | 3 | A vote can be cast, changed and withdrawn forever, so it loops. |
| Posted a comment | Effort | 1 | A few words: under a minute. |
| Posted a comment | Value | 2 | The other members read it on the task. |
| Posted a comment | Rarity | 0 | Members comment many times a day. |
| Posted a comment | Farm risk | 3 | Paired with deleting it, so post-and-delete loops. |
| Edited a comment | Effort | 1 | Changing a few words: under a minute. |
| Edited a comment | Value | 1 | Corrects your own words, which tidies up the discussion. |
| Edited a comment | Rarity | 0 | Comments can be edited many times a day. |
| Edited a comment | Farm risk | 3 | A comment can be edited back, so it loops. |
| Deleted a comment | Effort | 0 | One click. |
| Deleted a comment | Value | 1 | Tidies up the discussion. |
| Deleted a comment | Rarity | 0 | Comments can be deleted many times a day. |
| Deleted a comment | Farm risk | 3 | The undo half of the post-and-delete loop. |
| Send a message to another member | Effort | 1 | A few words: under a minute. |
| Send a message to another member | Value | 1 | Helps one other member, not the shared record. |
| Send a message to another member | Rarity | 0 | Members can send messages many times a day. |
| Send a message to another member | Farm risk | 2 | Repeatable in seconds, but a sent message has no undo, so it cannot loop. |
| Made a team | Effort | 1 | A name and a few details: under a minute. |
| Made a team | Value | 2 | Gives members a group to work in. |
| Made a team | Rarity | 1 | Teams are made a few times a week at most. |
| Made a team | Farm risk | 3 | Paired with deleting it, so make-and-delete loops. |
| Changed a team | Effort | 1 | Editing a name or details: under a minute. |
| Changed a team | Value | 1 | Keeps a team accurate, which tidies up. |
| Changed a team | Rarity | 0 | A team can be edited many times a day. |
| Changed a team | Farm risk | 3 | A team can be changed straight back, so it loops. |
| Deleted a team | Effort | 0 | One click. |
| Deleted a team | Value | 1 | Tidies up the list of teams. |
| Deleted a team | Rarity | 1 | Teams are deleted a few times a week at most. |
| Deleted a team | Farm risk | 3 | The undo half of the make-and-delete loop. |
| Added a member to a team | Effort | 0 | One click to put a member on a team. |
| Added a member to a team | Value | 2 | Brings a member into shared work the team relies on. |
| Added a member to a team | Rarity | 0 | Members can be added to teams many times a day. |
| Added a member to a team | Farm risk | 3 | Paired with removing them, so add-and-remove loops. |
| Removed a member from a team | Effort | 0 | One click. |
| Removed a member from a team | Value | 1 | Tidies up who is on a team. |
| Removed a member from a team | Rarity | 0 | Members can be taken off teams many times a day. |
| Removed a member from a team | Farm risk | 3 | The undo half of the add-and-remove loop. |
| Changed a member's role | Effort | 1 | Choosing a role takes under a minute. |
| Changed a member's role | Value | 2 | Governance the other members rely on. |
| Changed a member's role | Rarity | 1 | Roles change a few times a week at most, and only an admin can change one. |
| Changed a member's role | Farm risk | 3 | A role can be changed straight back, so it loops. |
| Approved a proposed task | Effort | 1 | Reading a proposal and approving it takes under a minute. |
| Approved a proposed task | Value | 2 | Admits work to the list that the other members pick up. |
| Approved a proposed task | Rarity | 0 | An admin can approve proposals many times a day. |
| Approved a proposed task | Farm risk | 2 | Each approval needs a proposal and cannot undo itself, but a proposal takes seconds to make. |
| Joined WaveCenter | Effort | 1 | Signing up is a short form: under a minute. |
| Joined WaveCenter | Value | 1 | New members are how the project grows; the value comes from what they do next, scored on its own. |
| Joined WaveCenter | Rarity | 2 | Once per member. |
| Joined WaveCenter | Farm risk | 1 | Once per member, but accounts are cheap to make (the canon's Sybil failure), so F is 1, not 0. |
| Changed a scoring rule | Effort | 1 | Editing a rule's wording or points: under a minute. |
| Changed a scoring rule | Value | 2 | Sets the values every member earns by. |
| Changed a scoring rule | Rarity | 1 | Rules change a few times a week at most, and only an admin can change one. |
| Changed a scoring rule | Farm risk | 3 | A rule can be changed straight back, so it loops. |
| Added a scoring action | Effort | 1 | A new action's name and criteria take about a minute. |
| Added a scoring action | Value | 2 | Grows the list of what counts, which every member earns by. |
| Added a scoring action | Rarity | 1 | New actions are added a few times a week at most, and only by an admin. |
| Added a scoring action | Farm risk | 2 | No rule can be deleted, so it cannot loop, but a new one takes a minute. |
| Sent a chat message | Effort | 1 | A few words: under a minute. |
| Sent a chat message | Value | 1 | Helps the other member in the chat, not the shared record. |
| Sent a chat message | Rarity | 0 | Members can send chat messages many times a day. |
| Sent a chat message | Farm risk | 2 | Repeatable in seconds, but a chat message cannot be edited or deleted, so it cannot loop. |

## Scoring an action added later

When an admin adds an action on Game → Manage, or an agent wires a new one:

1. Read its criteria ("exactly what counts").
2. Score E, V, R and F with the four tables above. For F, ask: does
   anything undo it, and can it be saved again unchanged? If so, F is 3.
   F is recorded for anti-farming work; it does not change the points.
3. Points = 1 + E + 2 × V + R.
4. Add a row to the table in this document with one line of reasons, and
   one sentence per factor to "Why each factor got its score", in the same
   pull request that wires the action, so the record stays complete.

An in-person action, when one exists, should be scored V = 3 and land near
the top of the scale (canon, "Trajectory: URL > IRL").

## Safeguards the formula cannot give

The formula does not stop loops: every action, looping or not, pays at
least 1 each time round. Three later safeguards would close that gap (the
ticket "Members could farm points before anyone is invited: finishing the
same task again and saving something unchanged still pay"). None is part of
this proposal; each is Dane's call:

- **Finishing the same task again earns no second finish.** Shipped: only the
  first time a task becomes done scores "Finished a task"; finishing it again
  after reopening it scores "Changed a task", so every real action still
  earns something.
- **An undo takes back what its action earned.** Deleting a task you made
  today would cancel that task's "Made a task" points, so a make-and-delete
  loop earns 0.
- **Saving something unchanged is not a change.** Shipped: a task, profile or
  AI agents switch saved with nothing different records nothing. Teams,
  scoring rules, comments and member roles already worked this way.

The canon's own longer-term defences are the members' votes on what each
action is worth, reputation weighting so "low-quality volume earns
commensurate tokens", and AI auditing of the ledger "for collusion and Sybil
patterns" (`docs/canon/deo-whitepaper.md`, "Failure Modes and Their
Defenses" and "Operations and Infrastructure").

## How a value goes live once Dane approves

The batch job has shipped ("Admin page batch job works out every action's
points by formula"). It needs no AI service and no API key: it is the
formula above, run by WaveCenter's own server when an admin clicks.

1. **The factors are stored.** Each row of `game_scoring_rules` carries its
   four factor scores (`effort`, `value`, `rarity`, `farm_risk`), filled for
   all 24 actions from the tables above by
   `supabase/migrations/20261102180000_scoring_factors.sql`. A row with none
   is "not scored yet". An admin changes them on Game → Manage
   (`/game/manage`), in the Factors column: four dropdowns whose options read
   the plain tests above. Adding an action asks for them too.
2. **The batch shows before it saves.** On the Admin page (`/admin`), an
   admin clicks **Recalculate action points**. WaveCenter works out every
   action's points with the formula (`granularPoints` in `core/game.ts`) and
   shows a table: each action, its four factors, its points now, its points
   proposed, and which would change. Clicking any factor's number opens a
   pop-up with its level test and the reason this action got it. Nothing is
   saved. An action not scored
   yet reads "not scored yet" and is left alone, never given 0 by accident.
3. **"Put these live" saves only the changed rows**, each through the same
   path as a change on Game → Manage (`changeScoringRule`, then the database's
   `update_scoring_rule`, both admin only). A row someone changed after the
   recalculation is not overwritten; it is listed as not saved, with the
   reason, and so is any row the database refused.
4. **The new value counts from the very next time the action happens.**
   Points already earned keep what they were given (`docs/DATA_MODEL.md`,
   "Who may change the scoring rules"). An admin can still type a single
   value by hand on Game → Manage; the next recalculation would propose the
   formula's value again.

## Questions for Dane

1. **Are the weights right?** Value counts twice; effort and rarity once
   each; farm risk not at all. Changing a weight changes every row, so it is
   the one decision that matters most.
2. **Are zeros acceptable?** Answered: no zeros, decided 2026-11-02. Dane:
   "I want a floor of 1 point. Every single action scores something."
   Farm risk was dropped from the formula, so every action scores at least
   1 (see "Why farm risk is not in the formula").
