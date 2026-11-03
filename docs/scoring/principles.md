# Principles

[← Scoring wiki](README.md)

## Everything a member does is scored

The canon makes this the defining commitment of a DEO: "every act of
engagement, from passive content consumption to software development to
governance itself, is captured, valued, and accrued to the member who
performed it" (`docs/canon/deo-whitepaper.md`, Abstract). The game layer is
"woven into the technical substrate rather than bolted on [...] nothing a
member contributes goes unaccounted for" (canon, "Engagement and
Intelligence").

Dane, 2026-10-27: "nothing happens within WaveCenter that isn't tracked and
scored" (`docs/DATA_MODEL.md`, "The game layer").

## Two types of score: granular and globular

Dane, 2026-11-01 (`docs/GRANULAR_SCORING_ALGORITHM.md`, "What Dane asked
for"):

> Granular scores are like those currently listed in the game layer. They
> are assigned for tiny, mechanical actions that can be discretely
> identified and tracked. They register automatically and don't require any
> thought on the part of the user. Globular scores are the kind like
> determining the value of a given task.

- **Granular**: one value per *kind* of action ("voted on a task" is worth
  N), recorded automatically. See [Granular scoring](granular.md).
- **Globular**: a value that needs thought to assess "accurately and
  defensibly against other globular scores", such as what a task is worth
  (`docs/DATA_MODEL.md`, "Granular and globular scores"). See
  [Globular scoring](globular.md).

## Scores grow with the complexity of the engagement

Dane, 2026-11-02, asking for this wiki:

> 'create a task' could have lots of different factors that adjust the
> value of that task being created. It will fractal out. And generally
> speaking, as it fractals out, it will be getting into value-add, and
> bigger numbers. So the size of scores increase with the complexity of the
> engagement. This means that the granular points scored through the
> automated 'machine level' will be minimal to the totals scored through
> higher level engagement through the globular scores. So we don't need to
> nail it at this level. They just need to make sense relative to each
> other.

What this means in practice:

- **"Fractal"**: one simple action, such as making a task, can later split
  into many factors that each adjust its value. The scoring system will keep
  branching like that as WaveCenter grows, which is why this wiki is built
  to grow too.
- **Granular points are small.** A granular action scores 1 to 12
  (`docs/GRANULAR_SCORING_ALGORITHM.md`, "The formula"). Most of a member's
  total is meant to come from globular scores, the thought-through value of
  real work.
- **Granular points only need the right order**, not exact worth: finishing
  a task well above making one, making one above deleting one
  (`docs/GRANULAR_SCORING_ALGORITHM.md`, "Granular points are small on
  purpose").

## Every action scores something

Dane, 2026-11-02: "I want a floor of 1 point. Every single action scores
something." (`docs/GRANULAR_SCORING_ALGORITHM.md`, "Why farm risk is not in
the formula").

## Members set the values, in the end

The canon says values are set "through a **continuously voted valuation
repository** [...] so that the value attributed to each form of engagement
gravitates toward it's natural level much as prices do in markets" (canon,
"Engagement and Intelligence"). Today an admin sets them; members' votes on
actions are planned (`docs/SCORING_GAME_PLAN.md`, sub-task 6).

## In-person engagement is valued highest

"In-person engagement is valued at the highest levels of the game layer"
(canon, "Trajectory: URL > IRL"). WaveCenter records no in-person action
yet, so the top of the granular scale is left free for one
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "The formula").

## Humans have the final say

AI may draft scores, but the DEO "holds the AI accountable through
multi-model consensus, auditable parameters, and the standing rule of human
primacy over every automated decision" (canon, "Operations and
Infrastructure"). Every granular factor score today was drafted by Claude
for Dane to approve, and nothing calls an AI while WaveCenter runs
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "Dane's answer").
