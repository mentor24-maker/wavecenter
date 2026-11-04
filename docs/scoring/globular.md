# Globular scoring

[← Scoring wiki](README.md)

Globular scores are "values that need thought to assess accurately and
defensibly against other globular scores, such as what a given task is
worth" (`docs/DATA_MODEL.md`, "Granular and globular scores"). See
[Principles](principles.md) for why they are meant to carry most of a
member's total.

## What exists today: a task's points

As read from the code on 2026-11-01 (`docs/SCORING_GAME_PLAN.md`, "What
exists today"):

- **The owner sets their own score.** The member who adds a task gives it
  points, a whole number from zero up, through `core/points.ts`; that number
  is the task's **owner's score** (`tasks.owner_points`). An owner's 0 is
  "not set". A finished task's points are locked until it is reopened.
- **The task's points are its final score** (since 2026-11-04,
  `core/taskScore.ts`): the plain average of the owner's score, the AI
  score (the newest AI rating) and the **others' score** (the average of
  the points votes of every member other than the owner), a half rounding
  up. A part a task does not have yet is left out. Before the AI has rated
  a task, its points are provisional, and its page says "AI: not yet".
  Example: AI 12, owner 10, no votes: final 11.
- **Members' votes** (`core/votes.ts`, the `task_votes` table) are the
  others' score. They no longer replace the owner's number. The average of
  priority votes is still the task's priority.
- **A member's finished-task score** adds up the points of their finished
  tasks (`core/score.ts`), shown on the Game page (`/game`).

**Task points and ledger points are separate.** What a task is worth and
what a member has earned in the ledger are not added together anywhere
(`docs/SCORING_GAME_PLAN.md`, "What exists today"; `docs/DATA_MODEL.md`,
"The game layer").

## What is planned

**The design:** [GLOBULAR_SCORING_ALGORITHM.md](../GLOBULAR_SCORING_ALGORITHM.md),
approved by Dane's merge of #146. Built so far: the ratings' home (#147), the
owner's score kept (#148), and the final score above. Not built yet: the AI
rating on the server, and the per-factor display on the task page.

### Dane's rule

Dane, 2026-11-03, on the ticket "Scoring system for Globular scores (epic
parent)":

> These ratings will be the AI-generated scores. We will also have a
> human-produced score, in the form of the score the person who creates the
> task gives it. We will average the AI score and the human score to arrive
> at the final score. Later, we will add a third factor, which is the
> average of all the other users' scores. Then we'll take the average of all
> three scores: AI, owner, others.

And: "the factors are used by AI to derive their final point value for the
score. It is that final point value that is being averaged with the human
scores."

So for every task:

1. **AI score.** The AI rates the task on four factors, scope, difficulty,
   relevance and demand, each 1 to 5. A formula turns the four ratings into
   one number of points, 1 to 50. Members do not rate factors.
2. **Owner's score.** The points the task's creator gives it.
3. **Final score** = the average of the AI score and the owner's score,
   a whole number, a half rounding up. This is the task's points.
4. **The others' score**, the average of the other members' scores, joins;
   final becomes the average of AI, owner and others. Dane brought this
   forward on 2026-11-04: "Since the voting is working, the final score is
   going to be the average of three scores: Owner's score, AI score,
   Average of other users' scores". Today's votes are the others' score.

**This replaces two earlier ideas.** Until 2026-11-04 members' votes
replaced the owner's points; now they are the others' score, one of three
equal parts. And the "human score" of `docs/SCORING_GAME_PLAN.md` (votes
averaged with the owner's score first) is no longer the plan.

How the AI rates (on the server, two models, with every reason kept, and a
human able to overrule it) is in the design, "How the AI rates".

**Built so far:** the ratings' home (`core/taskFactors.ts`, the
`ai_task_ratings` tables) and the AI rating run (`core/aiTaskRater.ts`,
the Admin page's "AI task ratings" button), which rates open tasks and
keeps every reason. The AI score does not yet change a task's points; the
final-score rule is its own ticket.

### Around it

The same parts can apply to each kind of game action, with the admin's
value as the owner's score and the granular formula as the AI score
(`docs/SCORING_GAME_PLAN.md`, "The same scoring for game behaviors").

Dane also described a **guess game**: a member guesses what
something is worth; the gap between the guess and the final score is their
**deviance score**, and the normalised average of those is their
**deviance quotient (DQ)** (`docs/SCORING_GAME_PLAN.md`, "The guess game").

None of this is built. The design has eight questions for Dane
(`docs/GLOBULAR_SCORING_ALGORITHM.md`, "Questions for Dane"), and the guess
game plan has its own (`docs/SCORING_GAME_PLAN.md`, "Questions for Dane").
See [Open questions](open-questions.md).
