# How a task is valued: a globular scoring design for Dane to approve

**Status: a proposal. Nothing in this document is built.** No task's points
change, and no AI rates anything, until Dane approves it. The five tickets
after this one (the ratings' home in the database, keeping the owner's
points, connecting the ratings to a task's points, the AI rating on the
server, and the task page) all wait for his approval. Written 2026-11-03
for the ticket "Dane approves how tasks are rated: a written globular
scoring design" (sub-ticket 1 of 6 under "Scoring system for Globular
scores (epic parent)"). It is sub-task 3 of `docs/SCORING_GAME_PLAN.md`.

The granular document, `docs/GRANULAR_SCORING_ALGORITHM.md`, values each
*kind* of small action. This one values each *individual task*: a
globular score, "values that need thought to assess accurately and
defensibly against other globular scores, such as what a given task is
worth" (`docs/DATA_MODEL.md`, "Granular and globular scores").

## What Dane asked for

Dane, 2026-11-03, on the WaveCenter task list (the parent ticket):

```
Now that we have our granular, mechanistic scoring system well in development, let's set up a new system for the globular scores, starting with tasks. We need a set of objective criteria on which we can rate tasks, such as the scope, difficulty, relevance, demand, etc. Then we can score any given task on a 5-point scale (or whatever) along any one of these factors. That's just my quick napkin sketch. Please develop a robust scoring system that 1) allows users to rank tickets along these lines and 2) allow AI to automatically assign a score for each task. Add related sub-tasks to this one.
```

## Dane's rule

His answer on the parent ticket, 2026-11-03, 5:51 PM MT:

```
These ratings will be the AI-generated scores. We will also have a human-produced score, in the form of the score the person who creates the task gives it. We will average the AI score and the human score to arrive at the final score. Later, we will add a third factor, which is the average of all the other users' scores. Then we'll take the average of all three scores: AI, owner, others.
```

And his clarification, 2026-11-03, 7:54 PM MT:

```
To be clear, the factors are used by AI to derive their final point value for the score. It is that final point value that is being averaged with the human scores.
```

So, in short:

1. **The AI rates each task on the factors below.** Members do not rate
   factors (Dane answered "A" on two tickets that proposed it).
2. **A formula turns the AI's factor ratings into one number of points:
   the AI score.**
3. **The owner's score** is the points the member who created the task
   gives it, as they do today (`core/points.ts`).
4. **Final score = the average of the AI score and the owner's score.**
   The final score is the task's points: the number on the task list and
   the one a finished task adds to its owner's score.
5. **Later, not built yet:** the others' score (the average of the other
   members' scores) joins, and final = the average of AI, owner and others.
   See "The later step".

## The four factors

The AI rates a task on four factors, each on Dane's **5-point scale, 1 to
5**. Each level has a one-line test, so a member can check any rating by
hand and argue with it.

They start from Dane's four (scope, difficulty, relevance, demand). Three
other candidates were considered and folded in rather than added:

- **Risk** (how likely the work is to break something) goes into
  **difficulty**: a risky change is a hard one to get right.
- **Urgency** goes into **demand**: work that is wanted now is in demand.
  Priority already exists on every task as its own field.
- **Leverage** (how much later work it unlocks) goes into **relevance**: a
  foundation the roadmap builds on is the most relevant work there is.

Keeping four keeps every rating easy to check. A fifth can be added later
the way a factor was added to granular scoring: by a ticket Dane approves.

### 1. Scope (S): how much there is to do

| S | Test |
|---|---|
| 1 | One small change in one place: a colour, a word, a size. |
| 2 | A few related changes on one screen, or one small new piece. |
| 3 | A new feature on one screen, or a change touching several screens. |
| 4 | A new section of the site, or a feature with its own database table. |
| 5 | A whole system, or a parent task that is split into many sub-tasks. |

### 2. Difficulty (D): how hard it is to get right

| D | Test |
|---|---|
| 1 | Anyone could do it from the description; nothing to work out. |
| 2 | One or two choices to make; the way to do it is well known. |
| 3 | Needs real thought or an outside service (email, sign-in, files). |
| 4 | Easy to get wrong in ways that matter: security, money, other members' data, or many moving parts. |
| 5 | Nobody knows yet how to do it; the design has to be worked out first. |

### 3. Relevance (R): how closely it serves the mission

Measured against WaveCenter's path in `CLAUDE.md` ("What we are building")
and `docs/MISSION.md`.

| R | Test |
|---|---|
| 1 | A matter of taste: it looks or reads a little better. |
| 2 | Makes something that exists easier or nicer to use. |
| 3 | Adds something members use to do the work. |
| 4 | Builds a step of the path: project management, inviting members, or the game layer. |
| 5 | Foundation the rest is built on: the game layer substrate, the task record, scoring itself. |

### 4. Demand (M): how much it is wanted

| M | Test |
|---|---|
| 1 | Nice to have; nobody is waiting for it. |
| 2 | One member asked for it, with no date in mind. |
| 3 | Members would notice it soon, or it is marked high priority. |
| 4 | Members are held back without it, or other tasks are waiting on it. |
| 5 | Blocking: work is stopped, something is broken, or it is marked urgent. |

### Why a 5-point scale

Dane's sketch said "a 5-point scale (or whatever)". Five is kept:

- **It is the scale people already know** (star ratings, surveys), so a
  member reading the AI's rating knows at once what a 4 means.
- **Three levels is too coarse.** A colour change and a new screen would
  both be "small" on scope.
- **Seven or ten levels is false precision.** No one, human or AI, can say
  why a task is a 6 and not a 7 on difficulty, and the levels could not
  each have a test.
- **There is no 0.** Every task has some scope, some difficulty, some
  relevance and some demand, or it would not be on the list.

## The formula

> **AI score = S × D × (R + M) ÷ 5**, rounded to a whole number, a half
> rounding up, and never less than 1.

Then:

> **Final score = (AI score + owner's score) ÷ 2**, rounded the same way.

- **Scope times difficulty is the work.** Multiplying, not adding, because
  they compound: a big easy task and a small hard task are both moderate,
  but a big hard task is far more than either. It runs from 1 to 25.
- **Relevance plus demand is how much that work is worth to the project.**
  Divided by 5, it is a multiplier from 0.4 (a taste matter nobody is
  waiting for) to 2 (blocking foundation work). A typical task (3 and 3)
  is 1.2. Added, not multiplied, so a task wanted urgently but off-mission,
  or on-mission but not wanted yet, still counts for something.
- **The AI score runs from 1 to 50.** That matches the owner's points on
  the task list today, where the biggest tasks are 50 ("Create basic game
  layer management", "Create Proposals process"). The two halves of the
  final score are on the same scale, so neither drowns the other.
- **Never less than 1.** A finished task always earns something. This
  follows Dane's granular rule, "I want a floor of 1 point. Every single
  action scores something" (2026-11-02,
  `docs/GRANULAR_SCORING_ALGORITHM.md`, "Questions for Dane").
- **Rounding happens once, at the end of each step**: whole numbers, a
  half rounding up, the same rule as votes today (`core/votes.ts`). When
  more than one AI model rates a task (see "How the AI rates"), their
  ratings are averaged without rounding, and only the AI score is rounded.

A quick feel for the numbers:

| Task | S | D | R | M | AI score |
|---|---|---|---|---|---|
| Change a word | 1 | 1 | 1 | 1 | 0.4, so **1** |
| A typical new feature | 3 | 3 | 3 | 3 | 10.8, so **11** |
| A whole system, foundation, blocking | 5 | 5 | 5 | 5 | **50** |

## Worked examples on real WaveCenter tasks

Read from the WaveCenter task list on 2026-11-03. The ratings below are
this document's own (Claude's), made by hand with the tests above, to show
the formula at work. They are not stored anywhere. The owner's score is
each task's points today.

**1. "Create basic game layer management."** (owner's score 50) "Build a
foundational substrate for the WaveCenter platform based on this game
layer. [...] nothing happens within WaveCenter that isn't tracked and
scored."

- S = 5 (a whole system), D = 4 (every feature has to report to it; many
  moving parts), R = 5 (the game layer substrate itself), M = 4 (the
  scoring tasks after it wait on it).
- AI score = 5 × 4 × (5 + 4) ÷ 5 = 36.
- Final = (36 + 50) ÷ 2 = **43**.

**2. "Set up a proper registration/login process, including Google Oauth
login, and any others that don't require red tape."** (owner's score 30)

- S = 3 (new sign-up and sign-in screens), D = 3 (an outside service:
  Google sign-in), R = 3 (members need it to do anything), M = 4 (no new
  member can join without it).
- AI score = 3 × 3 × (3 + 4) ÷ 5 = 12.6, so 13.
- Final = (13 + 30) ÷ 2 = 21.5, so **22**.

**3. "Create a user-facing game dashboard."** (owner's score 20)
"Includes leaderboard, rankings, contribution types, etc."

- S = 4 (a new section with several parts), D = 3 (rankings need real
  thought about fairness), R = 4 (the game layer), M = 3 (members would
  notice it soon).
- AI score = 4 × 3 × (4 + 3) ÷ 5 = 16.8, so 17.
- Final = (17 + 20) ÷ 2 = 18.5, so **19**.

**4. "Use the other version of the header background."** (owner's score 5)
"There are two versions of the the background image. Use the other one with
the dark colors on the left."

- S = 1, D = 1, R = 1 (taste), M = 2 (Dane asked for it).
- AI score = 1 × 1 × (1 + 2) ÷ 5 = 0.6, so 1.
- Final = (1 + 5) ÷ 2 = **3**.

What the examples show: the owner and the AI broadly agree on which tasks
are big, and the AI is more cautious at the top. On these four, the final
score pulls a little below the owner's own number. Whether the 50 at the top
of the AI's scale is right is question 5.

## The later step: the others' score (not built yet)

Dane: "Later, we will add a third factor, which is the average of all the
other users' scores. Then we'll take the average of all three scores: AI,
owner, others."

- **The others' score** is the plain average of the points every *other*
  member gives the task (not the owner, not the AI), rounded the usual way.
- **Final score = (AI score + owner's score + others' score) ÷ 3**, each
  part weighing the same.
- **With no other member's score yet**, the others' part is left out and
  final stays the average of AI and owner, so a task is never stuck.

A worked example, on example 3 above: the AI says 17 and the owner 20. Three
other members say 15, 20 and 25; the others' score is 20. Final =
(17 + 20 + 20) ÷ 3 = 19.

This step has no ticket yet. It is filed once Dane says "now", together
with what happens to today's votes (question 2).

## How the AI rates

The canon sets the terms. The DEO "holds the AI accountable through
multi-model consensus, auditable parameters, and the standing rule of
human primacy over every automated decision"
(`docs/canon/deo-whitepaper.md`, "Operations and Infrastructure"). It also
describes the AI "modeling provisional consensus baselines where human
quorum is lacking (always subject to human override)", which is what the AI
score is: a considered baseline beside the owner's own judgment.

### Where it runs

On WaveCenter's server only, never in the member's browser. The key to the
AI service lives in Doppler and the server's settings and never reaches the
page (engineering rule 3). It is an ordinary call to the AI service's public
API from WaveCenter's own server code, which works on any host, not a
Vercel-only feature (engineering rule 11). Dane supplies the key when the
AI ticket is built ("The AI rates each task's factors on the server, with
reasons"); it is a billing matter, so it is his.

### What it reads

- The task's title and details (notes), its priority, its parent task's
  title, and its sub-tasks' titles.
- The names of its attached files, not their contents.
- The four factor tables in this document, word for word, and a short
  summary of WaveCenter's path (from `CLAUDE.md` and `docs/MISSION.md`), so
  it can judge relevance.

What it does **not** read:

- **The owner's score, or any member's vote.** The AI score is meant to be
  an independent second opinion. If the AI saw the owner's 50 first, it
  would lean towards 50, and the average would just repeat the owner.
- **Anyone's profile or private data.**

### Its instructions

A fixed set of instructions, kept in the repository as a file with a
version number, so every change to them is a pull request anyone can read.
In plain words, they say:

1. Rate this task on each of the four factors, 1 to 5, using only the
   tests in the tables.
2. For each factor, give the level and one sentence saying which test the
   task meets and why.
3. Judge from what the task says. If the description is too thin to rate a
   factor, rate it as written and say so in the reason; do not guess what
   the owner meant.
4. Answer in a fixed format the server can check (four numbers from 1 to 5
   and four reasons). An answer that is not in that format is refused and
   not saved, and the task stays unrated (engineering rule 6: a failed save
   says so).

The AI gives only the four ratings. **The server does the arithmetic**,
with the formula above, so the AI can never invent a points number outside
the scale.

### Which models

**Multi-model consensus:** two models rate every task, separately,
defaulting to the latest Claude models: **Claude Opus 5.5**
(`claude-opus-5-5`) and **Claude Sonnet 5.5** (`claude-sonnet-5-5`). Each
factor's rating is the average of the two. If the two disagree by **2 or
more levels** on any factor, the task is marked "the AI models disagree",
so a human knows to look at it (see "How a human overrules it"). Adding a
model from a different maker is question 6.

### How its reasons are kept

**Auditable parameters:** each rating is saved as a record any signed-in
member can read, and only the server can write:

- the task, and when it was rated;
- for each model: which model (its exact id), its four ratings and four
  reasons;
- the version of the instructions it was given;
- a fingerprint of what it read (title, details and the rest), so anyone
  can tell whether the task has changed since;
- the averaged ratings and the AI score they make.

A new rating never overwrites an old one. Each is kept, newest first, so
the history of how a task's AI score moved can always be read back.

### When it rates

When a task is made, and again when its title or details change. Not once
the task is done: a done task's points are locked (`core/points.ts`), and
re-rating it would quietly change what its owner has earned. Whether to
rate the tasks that are already on the list is question 4.

### How a human overrules it

**Human primacy:** a person always has the last word.

- **Always:** the AI is never more than half of the final score today,
  and a third once the others' score arrives. The owner's own number is the
  other half and always counts.
- **Proposed:** an admin may replace any of the AI's factor ratings on a
  task with their own, with a written reason. The override is saved beside
  the AI's original (never in place of it), the AI score is worked out
  from the override, and the task page says "overruled by an admin" and
  shows the reason. Which overrules Dane wants is question 3.

## Questions for Dane

1. **Until the AI has rated a task, what is its final score?**
   - **A. The owner's score alone** (proposed). The task page says "AI
     score: not yet", so a task is never stuck at no score.
   - **B. No final score yet.** The task shows its owner's number marked
     "provisional" until the AI has rated it.
2. **What happens to today's votes until the others' score is built?**
   Today any member may vote one number on a task, and the votes' average
   *replaces* the owner's points (`votedValues` in `core/votes.ts`). Four
   tasks have been voted on so far.
   - **A. Keep counting as today.** The votes' average stands in for the
     owner's score on those tasks. Simple, but it breaks your rule that the
     owner's score is the owner's.
   - **B. Recorded but not counted** (proposed). Votes are kept and shown,
     and the vote box stays; final = average of AI and owner. When the
     others' score is built, these votes become its first scores.
   - **C. Hidden.** The vote box is taken away until the others' score is
     built; votes already cast are kept, unseen.
3. **How does a human overrule the AI?**
   - **A. An admin replaces a factor rating, with a reason** (proposed).
   - **B. The owner may ask for a fresh rating**, once, if they think the
     AI misread the task; no one types over the AI.
   - **C. No overrule** beyond the AI being half the final score.
   - A and B can both be had.
4. **Does the AI rate the tasks already on the list?**
   - **A. Open tasks only** (proposed). Done tasks keep the points they
     finished with, so no one's earned total moves.
   - **B. Every task, done ones too**, while scoring is provisional, the
     way the granular rescoring did ("Points earned under early guesswork
     values stay wrong forever", #142). Members' finished-task totals would
     change.
   - **C. New tasks only.**
5. **Is 50 the right top of the scale?** The AI score runs from 1 to 50,
   to match the biggest tasks on the list today.
   - **A. Keep 50** (proposed).
   - **B. A larger top, such as 100**, leaving room above today's biggest
     tasks. The formula's "÷ 5" becomes "÷ 2.5".
6. **Which models?**
   - **A. Two Claude models**, Opus 5.5 and Sonnet 5.5 (proposed).
   - **B. Add a model from a different maker**, so the consensus is not one
     company's view. It needs a second AI service account and key.
   - **C. One model** to start. Cheaper, but not multi-model consensus.
7. **What is the owner's score on tasks already voted on?** Votes
   overwrote the owner's own number on those four tasks, and the task keeps
   only one number, so the original is gone.
   - **A. Their points as they stand now** (the votes' average), and the
     owner may change it.
   - **B. Ask each owner to set it again**; until then, the task's owner's
     score is "not set" and final is the AI score alone.
   - **C. Look for the original** in any other record that kept it, and
     fall back to A where none did.
8. **Does an owner's 0 mean "worth nothing" or "not set"?** Many tasks on
   the list have 0 points because their owner never set any.
   - **A. "Not set"** (proposed): final is the AI score alone until the
     owner gives a number.
   - **B. A real 0**: it is averaged in, halving the AI score.
