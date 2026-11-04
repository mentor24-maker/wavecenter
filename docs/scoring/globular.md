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

- **The owner suggests a value.** The member who adds a task sets its
  points, a whole number from zero up, through `core/points.ts`. A finished
  task's points are locked until it is reopened.
- **Members' votes replace it.** Any signed-in member may vote on what a
  task is worth (`core/votes.ts`, the `task_votes` table). The task's points
  become the plain average of the votes, a half rounding up. From the first
  vote on, the owner's own number no longer counts.
- **A member's finished-task score** adds up the points of their finished
  tasks (`core/score.ts`), shown on the Game page (`/game`).

**Task points and ledger points are separate.** What a task is worth and
what a member has earned in the ledger are not added together anywhere
(`docs/SCORING_GAME_PLAN.md`, "What exists today"; `docs/DATA_MODEL.md`,
"The game layer").

## What is planned

**The design:** [GLOBULAR_SCORING_ALGORITHM.md](../GLOBULAR_SCORING_ALGORITHM.md),
a proposal for Dane to approve. Nothing in it is built.

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
4. **Later, not built yet:** the **others' score**, the average of the other
   members' scores, joins; final becomes the average of AI, owner and
   others.

**This replaces two earlier ideas.** Today members' votes replace the
owner's points; under Dane's rule they do not count until the others'
score is built. And the "human score" of `docs/SCORING_GAME_PLAN.md`
(votes averaged with the owner's score) is no longer the plan.

How the AI rates (on the server, two models, with every reason kept, and a
human able to overrule it) is in the design, "How the AI rates".

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
