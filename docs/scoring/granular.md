# Granular scoring

[← Scoring wiki](README.md)

Granular scores are the small automatic points for tiny, mechanical actions
(see [Principles](principles.md)). The full factor tables and every
action's scores are in
[GRANULAR_SCORING_ALGORITHM.md](../GRANULAR_SCORING_ALGORITHM.md); this
page is the short version.

## One value per kind of action

Each kind of action is one row of the `game_scoring_rules` table: a name,
what exactly counts, and its points. Every time a member does one, the
database writes a row in the ledger (`engagements`) in the same step as the
save, copying the points from the rule at that moment. Changing a rule
later never rewrites what someone already earned (`docs/DATA_MODEL.md`,
"The game layer").

24 actions are listed. Ten earn points today; the other fourteen show "Not
active yet" on Game → Manage until each is wired up
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "The table").

## The four factors

Each kind of action gets a whole-number score on four factors, each with a
plain test per level (`docs/GRANULAR_SCORING_ALGORITHM.md`, "The four
factors"):

| Factor | Range | Asks |
|---|---|---|
| Effort (E) | 0 to 3 | How much of the member's time and attention the action takes. |
| Value (V) | 0 to 3 | What it does for the project and for other members. |
| Rarity (R) | 0 to 2 | How often a member genuinely does it. |
| Farm risk (F) | 0 to 3 | How easily it can be repeated just to collect points. |

## The formula

> **Points = 1 + E + 2 × V + R**

This is `granularPoints` in `core/game.ts`.

- **The 1** is the starting point every recorded action gets, so none
  scores 0.
- **Value counts twice**, because value is the reason the game layer exists.
- **The range is 1 to 12.** Finishing a task proposes 11; switching the AI
  agents on or off proposes 1.

A worked example, voting on a task: E = 1, V = 2, R = 0, so
1 + 1 + 4 + 0 = **6** (`docs/GRANULAR_SCORING_ALGORITHM.md`, "The formula").

## Why farm risk is scored but not counted

The first version took F away from the total, and six actions came out at
0. 19 of the 24 actions have F = 3, so it worked as a flat −3 that barely
told actions apart. Dane, 2026-11-02: "I agree to all three. Drop F at this
level." F is still scored and stored, kept for the
[anti-farming](anti-farming.md) work to come
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "Why farm risk is not in the
formula"; pull request #131).

## How a value goes live

1. The four factors are stored on each rule (`effort`, `value`, `rarity`,
   `farm_risk`, all four or none; none means "not scored yet").
2. On the Admin page (`/admin`), an admin clicks **Recalculate action
   points**. WaveCenter shows each action's points now and by the formula.
   Nothing is saved yet.
3. **Put these live** saves only the rows that change, through the same
   admin-only path as Game → Manage.
4. The new value counts from the next time the action happens.

(`docs/GRANULAR_SCORING_ALGORITHM.md`, "How a value goes live once Dane
approves"; `docs/DATA_MODEL.md`, "Who may change the scoring rules".)

## How an admin scores a new action

On Game → Manage (`/game/manage`), only a role with manage game scoring
(`game.edit`, admin only to start) may add an action or change one. Adding
one asks for its four factors from dropdowns that read the plain tests
(`docs/DATA_MODEL.md`, "Who may change the scoring rules"). The steps
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "Scoring an action added later"):

1. Read what exactly counts.
2. Score E, V, R and F with the four tables. For F, ask: does anything undo
   it, and can it be saved again unchanged? If so, F is 3.
3. Points = 1 + E + 2 × V + R.
4. Add a row with one line of reasons to the table in
   `docs/GRANULAR_SCORING_ALGORITHM.md`, in the same pull request that wires
   the action.

A new action is not active until an agent wires it to a function, a
database trigger and a test (`docs/DATA_MODEL.md`, "Who may change the
scoring rules").
