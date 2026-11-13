# The scoring wiki

How WaveCenter scores what its members do, and why. Scoring is how the DEO
keeps its central promise: "every act of engagement [...] is captured,
valued, and accrued to the member who performed it"
(`docs/canon/deo-whitepaper.md`, Abstract).

Each page is short and cites where its claims come from: a file, a section
of the canon, or Dane's own quoted words. When a page and the code
disagree, the code is what runs; fix the page in the same pull request.

Started 2026-11-03 for the ticket "Nobody can learn how WaveCenter scoring
works in one place: start a scoring wiki that can grow as the system does".

## Pages

### Start here

- [Principles](principles.md): the two types of score, why scores grow
  with the complexity of the engagement, why granular points are small,
  and why every form of engagement earns points.
- [Glossary](glossary.md): the words this wiki uses.

### How scores are worked out

- [Granular scoring](granular.md): the small automatic points for each kind
  of action, the four factors and the formula, and rescoring past points
  while scoring is provisional.
- [Globular scoring](globular.md): values that need thought, such as what a
  task is worth. What exists today, and Dane's rule: final = the average of
  the AI score and the owner's score.

### Keeping scores honest

- [Anti-farming](anti-farming.md): why gaming is not a reason to leave an
  action unscored, and how WaveCenter stops points being collected by
  repeating actions, in stages.

### Not settled yet

- [Open questions](open-questions.md): what the canon and the documents do
  not settle, written as questions for Dane.

## The longer documents this wiki summarises

The wiki links to these rather than copying them:

- [GRANULAR_SCORING_ALGORITHM.md](../GRANULAR_SCORING_ALGORITHM.md): the
  factor tables and every action's scores.
- [GLOBULAR_SCORING_ALGORITHM.md](../GLOBULAR_SCORING_ALGORITHM.md): the
  task factors, the scale, the formula and how the AI rates, for Dane to
  approve.
- [SCORING_GAME_PLAN.md](../SCORING_GAME_PLAN.md): the plan for owner, AI
  and final scores, and the guess game.
- [DATA_MODEL.md](../DATA_MODEL.md): the tables, in particular "The game
  layer" and "Granular and globular scores".
- [canon/deo-whitepaper.md](../canon/deo-whitepaper.md): the DEO
  whitepaper, word for word.

## Pages still to write

Add a page here when its subject is built or planned, not before.

- **Members vote on what each action is worth** (the canon's "continuously
  voted valuation repository"), once that is built.
- **The guess game, deviance and DQ**, once Dane answers the plan's
  questions (`docs/SCORING_GAME_PLAN.md`).
- **The AI score**: what it reads and how a human overrules it, once
  Dane approves the design (`docs/GLOBULAR_SCORING_ALGORITHM.md`).
- **Negative scores for behaviour**: Dane's later "anti-farming behavior
  negative scores".
- **Reputation and voting weight**: earned tokens multiplied by
  reputation (canon, "Engagement and Intelligence").
- **In-person engagement**, valued highest (canon, "Trajectory: URL > IRL").
- **Levels, rewards and the leaderboard** (held off by Dane, 2026-10-30).

## Adding a page

1. One subject per page, in plain language, under about a screen and a half.
2. Start it with a link back to this index, and add it to the list above.
3. Cite every claim about how scoring works. If nothing settles a point,
   do not guess: add it to [Open questions](open-questions.md).
