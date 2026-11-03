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

Dane, 2026-11-01, described four scores for every task
(`docs/SCORING_GAME_PLAN.md`, "The scores, as Dane described them"):

1. **Owner's score**: the owner's suggested points.
2. **Human score**: the members' votes averaged with the owner's score.
3. **AI score**: what an AI assessment says, by an algorithm "that we will
   determine together".
4. **Final score**: the average of the AI score and the human score.

The same four can apply to each kind of game action, with the admin's value
as the owner's score and the granular formula as the AI score
(`docs/SCORING_GAME_PLAN.md`, "The same scoring for game behaviors").

Around these, Dane described a **guess game**: a member guesses what
something is worth; the gap between the guess and the final score is their
**deviance score**, and the normalised average of those is their
**deviance quotient (DQ)** (`docs/SCORING_GAME_PLAN.md`, "The guess game").

None of this is built. The plan lists ten sub-tasks in build order and
eight questions for Dane (`docs/SCORING_GAME_PLAN.md`, "Sub-tasks, in build
order" and "Questions for Dane"). See [Open questions](open-questions.md).
