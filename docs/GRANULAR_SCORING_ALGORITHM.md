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
and over. The algorithm below fixes both.

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

**Rarity counts only when the action cannot loop** (F below 3): an action
that can be repeated forever is not rare, however seldom an honest member
does it.

**4. Farm risk (F), 0 to 3.** How easily the action can be repeated just to
collect points. It is subtracted. The canon names this danger: the
valuation repository exists so the membership can keep "deflating any
category being farmed" (`docs/canon/deo-whitepaper.md`, "Failure Modes and
Their Defenses").

| F | Test |
|---|---|
| 0 | Cannot be repeated (once per member), or costs real work every time. |
| 1 | Repeatable, but each time needs something real from someone else. |
| 2 | Repeatable in seconds with no real input, but it cannot undo itself. |
| 3 | Repeatable in seconds **and** it loops: a switch flipped back, a save of the same thing, or an action paired with its own undo (make / delete). |

## The formula

> **Points = 1 + E + 2 × V + R − F**, and never below 0.
> (R counts as 0 when F is 3.)

- **The 1 is the starting point every recorded action gets**, because
  nothing a member does goes unaccounted (canon, "Engagement and
  Intelligence"). A pure loop with no value cancels it out and earns 0. An
  action worth 0 is still recorded in the ledger; it just adds nothing to
  the total.
- **The lowest possible score is 0 and the highest is 12** (1 + 3 + 6 + 2).
  No granular action proposed here goes above 7. The top of the scale is left
  free on purpose: the canon says "in-person engagement is valued at the
  highest levels of the game layer" (`docs/canon/deo-whitepaper.md`,
  "Trajectory: URL > IRL"), and WaveCenter records no in-person action yet.
- **The result is a whole number from 0 up**, which is exactly what Game →
  Manage accepts.

A worked example, voting on a task: E = 1 (a judgment, a few seconds),
V = 2 (other members rely on the result: it sets what the task is worth),
R = 0 (many a day), F = 3 (a vote can be cast, changed and withdrawn
forever). Points = 1 + 1 + 4 + 0 − 3 = **3**.

## The table

### The ten actions that earn points today (`ENGAGEMENT_KINDS`, `core/game.ts`)

| Action | Now | E | V | R | F | Proposed | Why |
|---|---|---|---|---|---|---|---|
| Made a task | 1 | 1 | 2 | 0 | 3 | **3** | Adds work others can pick up; paired with deleting it, so it loops. |
| Changed a task | 1 | 1 | 1 | 0 | 3 | **1** | Keeps a task accurate; any edit can be changed straight back. |
| Finished a task | 5 | 3 | 3 | 1* | 3 | **7** | Records real finished work; reopening and finishing again loops (see safeguards). |
| Deleted a task | 1 | 0 | 1 | 0 | 3 | **0** | Housekeeping worth having, but paying for it pays the make-and-delete loop twice. |
| Attached a file | 1 | 1 | 2 | 0 | 3 | **3** | Gives others the picture or file they need; paired with removing it. |
| Removed a file | 1 | 0 | 1 | 0 | 3 | **0** | Tidies up; the undo half of a loop. |
| Handed a task to AI agents | 1 | 0 | 2 | 1 | 2 | **4** | Puts work into the build queue; once per task, but a task takes seconds to make. |
| Switched AI agents on or off | 1 | 0 | 0 | 0 | 3 | **0** | A personal switch that flips back and forth. |
| Changed your profile | 1 | 1 | 1 | 1* | 3 | **1** | Helps others know who you are; saving the same profile again loops. |
| Voted on a task | 1 | 1 | 2 | 0 | 3 | **3** | Sets what tasks are worth, which others rely on; a vote can be changed forever. |

\* Rarity does not count, because the action loops (F = 3).

### The fourteen actions listed but not active yet

These were added by the "Update the complete list of possible actions
members can score points for" ticket (#101,
`supabase/migrations/20261102120000_scoring_actions_sweep.sql`) for the
linked WaveCenter task `8dcc80e0-7b59-4fc6-bf62-dd2c3c5cc89d`. Each shows
"Not active yet" on Game → Manage and earns nothing until it is wired, one
ticket each.

| Action | Now | E | V | R | F | Proposed | Why |
|---|---|---|---|---|---|---|---|
| Posted a comment | 1 | 1 | 2 | 0 | 3 | **3** | Others read it on the task; paired with deleting it. Same as making a task. |
| Edited a comment | 1 | 1 | 1 | 0 | 3 | **1** | Corrects your own words; can be edited back. |
| Deleted a comment | 1 | 0 | 1 | 0 | 3 | **0** | The undo half of a loop. |
| Send a message to another member | 1 | 1 | 1 | 0 | 2 | **2** | Helps one member, not the shared record; each needs words, and there is no undo. |
| Made a team | 1 | 1 | 2 | 1* | 3 | **3** | Gives members a group to work in; paired with deleting it. |
| Changed a team | 1 | 1 | 1 | 0 | 3 | **1** | Keeps a team accurate; can be changed back. |
| Deleted a team | 1 | 0 | 1 | 1* | 3 | **0** | The undo half of a loop. |
| Added a member to a team | 1 | 0 | 2 | 0 | 3 | **2** | Brings a member into shared work; paired with removing them. |
| Removed a member from a team | 1 | 0 | 1 | 0 | 3 | **0** | The undo half of a loop. |
| Changed a member's role | 1 | 1 | 2 | 1* | 3 | **3** | Governance others rely on; a role can be changed straight back. Admin only. |
| Approved a proposed task | 1 | 1 | 2 | 0 | 2 | **4** | Reviews and admits work to the list; each needs a proposal, but one takes seconds. Admin only. |
| Joined WaveCenter | 1 | 1 | 1 | 2 | 1 | **5** | Once per member, and new members are how the project grows; the value comes from what they do next, scored on its own. Accounts are cheap to make (the canon's Sybil failure), so F is 1, not 0. |
| Changed a scoring rule | 1 | 1 | 2 | 1* | 3 | **3** | Sets values every member earns by; can be changed back. Admin only. |
| Added a scoring action | 1 | 1 | 2 | 1 | 2 | **5** | Grows the list of what counts; no rule can be deleted, so it cannot loop, but a new one takes a minute. Admin only. |

\* Rarity does not count, because the action loops (F = 3).

## Scoring an action added later

When an admin adds an action on Game → Manage, or an agent wires a new one:

1. Read its criteria ("exactly what counts").
2. Score E, V, R and F with the four tables above. Ask especially: does
   anything undo it, and can it be saved again unchanged? If so, F is 3 and
   R counts as 0.
3. Points = 1 + E + 2 × V + R − F, never below 0.
4. Add a row to the table in this document with one line of reasons, in the
   same pull request that wires the action, so the record stays complete.

An in-person action, when one exists, should be scored V = 3 and land near
the top of the scale (canon, "Trajectory: URL > IRL").

## Safeguards the formula cannot give

The formula lowers what a loop pays, but a positive action that loops still
pays something each time round. Three later tickets would close that gap.
None is part of this proposal; each is Dane's call:

- **Finishing the same task again earns nothing.** Only the first time a task
  becomes done would score "Finished a task".
- **An undo takes back what its action earned.** Deleting a task you made
  today would cancel that task's "Made a task" points, so a make-and-delete
  loop earns 0.
- **Saving something unchanged is not a change.** A profile, task or rule
  saved with nothing different would record nothing.

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
   proposed, and which would change. Nothing is saved. An action not scored
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

1. **Are the weights right?** Value counts twice; effort, rarity and farm
   risk once each. Changing a weight changes every row, so it is the one
   decision that matters most.
2. **Are zeros acceptable?** Six actions (five undo halves of loops, and the
   AI agents switch) come out at 0. They are still recorded in the ledger;
   they just add nothing. The alternative is a floor of 1, which keeps
   today's "a point a second" loop open.
