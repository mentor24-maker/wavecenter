# Open questions

[← Scoring wiki](README.md)

Points that neither the canon nor WaveCenter's documents settle, written as
questions for Dane. They are not answered here by guesswork (`CLAUDE.md`,
"What we are building"). When Dane answers one, record his words on the
page it belongs to, cite where he said it, and remove it from this list.

## Already asked elsewhere

These are open in their own documents (as of 2026-11-03), so they are only
pointed to here:

- **Are the granular weights right?** Value counts twice, effort and rarity
  once each, farm risk not at all (`docs/GRANULAR_SCORING_ALGORITHM.md`,
  "Questions for Dane", question 1).
- **The questions of the scoring guess game**: what "normalized" means for
  DQ, how a human overrules the AI, when a guess settles, and more
  (`docs/SCORING_GAME_PLAN.md`, "Questions for Dane"). The first, how the
  human score is averaged, Dane answered on 2026-11-03: final = the average
  of the AI score and the owner's score.
- **The eight questions of the globular design**: what a task's final score
  is before the AI rates it, what happens to today's votes, how a human
  overrules the AI, and more (`docs/GLOBULAR_SCORING_ALGORITHM.md`,
  "Questions for Dane").

## New questions

1. **Where does granular end and globular begin?** You said "'create a
   task' could have lots of different factors that adjust the value of that
   task being created." When those factors arrive, is making a task still
   one granular value per kind, or does each task made get a value of its
   own, which would make it globular?
2. **How do the two kinds of points meet?** Today a task's points and a
   member's ledger points are never added together
   (`docs/SCORING_GAME_PLAN.md`, "What exists today"). Will a member have
   one total, or two scores shown side by side?
3. **How much bigger should globular scores be?** You said granular points
   "will be minimal to the totals scored through higher level engagement".
   Granular actions score 1 to 12 today. Is there a size you have in mind
   for a typical task, or is that left to members' votes?
4. **What are behaviour negative scores?** You said "In time, we will be
   adding more sophisticated anti-farming behavior negative scores." Which
   behaviour would be scored, who or what decides it, and can a member's
   total go below zero?
5. **Does farm risk come back?** It is scored and stored but not counted.
   Is it meant to feed the negative scores in question 4, or something else?
6. **Do you want the third safeguard?** "An undo takes back what its action
   earned" (`docs/GRANULAR_SCORING_ALGORITHM.md`, "Safeguards the formula
   cannot give") is not part of the first anti-farming ticket. Build it, or
   leave it for the negative scores?
