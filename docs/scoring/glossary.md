# Glossary

[← Scoring wiki](README.md)

**Engagement.** One thing one member did: made a task, voted, attached a
file. The canon's founding resource: "human engagement — rather than
capital investment — is the founding resource, the operating fuel, and the
ultimate purpose of the enterprise" (`docs/canon/deo-whitepaper.md`,
Abstract). In WaveCenter, one row of the `engagements` table
(`docs/DATA_MODEL.md`, "The game layer").

**Factor.** One of the four things a granular action is scored on: Effort,
Value, Rarity and Farm risk. Each is a whole number with a plain test per
level (`docs/GRANULAR_SCORING_ALGORITHM.md`, "The four factors"). See
[Granular scoring](granular.md).

**Farming.** Repeating an action just to collect points. The canon speaks
of "deflating any category being farmed" (canon, "Failure Modes and Their
Defenses"). **Farm risk** is the factor that measures how easily an action
can be farmed. See [Anti-farming](anti-farming.md).

**Game layer.** The part of WaveCenter that captures, values and credits
every engagement. "The game layer is the ledger of engagement, and it is
native — woven into the technical substrate rather than bolted on" (canon,
"Engagement and Intelligence").

**Globular score.** A value that needs thought to assess, such as what a
task is worth (Dane, 2026-11-01; `docs/DATA_MODEL.md`, "Granular and
globular scores"). See [Globular scoring](globular.md).

**Granular score.** The automatic value for a tiny, mechanical kind of
action, such as attaching a file; one value per kind (Dane, 2026-11-01;
`docs/DATA_MODEL.md`, "Granular and globular scores"). See
[Granular scoring](granular.md).

**Ledger.** The record of every engagement and the points it earned: the
`engagements` table. Only the database's save step writes to it; nobody can
change a row, not even their own (`docs/DATA_MODEL.md`, "The game layer").

**Points.** The game layer's unit of value. Members earn points and
tokens, never dollars (canon, "The Economy"). WaveCenter has two kinds
today, kept separate: a task's `points` (what it is worth) and the
points a member has earned in the ledger (`docs/SCORING_GAME_PLAN.md`,
"What exists today").

**Scoring rule.** One row of `game_scoring_rules`: a kind of action, what
exactly counts, its points and its four factors (`docs/DATA_MODEL.md`,
"The game layer").
