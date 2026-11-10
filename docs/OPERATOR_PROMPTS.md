# Operator prompts

Every prompt Dane writes in an agent session, word for word and in order,
with what it led to: tickets, pull requests, doc changes and decisions. His
prompts are the seed of everything the loop builds, so this log is the trail
from his words to the work. One section per thread, newest at the bottom.
Earlier entries are history and stay as written. Material he pasted in (a
screenshot, a log) is named in square brackets, not copied.

Tickets are in the WaveCenter Loop Queue (`https://app.clickup.com/t/<id>`);
pull requests are on `mentor24-maker/wavecenter`.

## 2026-11-02 to 2026-11-10: Recalculate action points, farm risk and rescoring past points

1. [pasted: screenshot of Admin → Recalculate action points]

   > Can you explain what this recalculate action points chart shows in terms of the Proposed Change column. I can't see how those numbers relate to the Now column (which is my manual score) and the EVRF scores, (which are the automated factors). Please clarify.

   Led to: an explanation. "ProposedChange" was two columns printed with no gap ("3" + "1 → 3" read as "31 → 3"), and Proposed comes from the formula, not from Now. Nothing filed until prompt 2.

2. > Yes, fixe the squashed columns. Also, make each one of the factor values link to a popup that states why that score was given for that particular task on that factor.

   Led to:
   - [86bcx2fur](https://app.clickup.com/t/86bcx2fur) "Dane cannot read the Recalculate action points table: the Proposed and Change columns run together ("31 → 3") and the formula is not shown" → [#130](https://github.com/mentor24-maker/wavecenter/pull/130)
   - [86bcx2fyj](https://app.clickup.com/t/86bcx2fyj) "Dane cannot see why an action got its Effort, Value, Rarity or Farm-risk score: click a factor in Recalculate action points to see the reason" → [#134](https://github.com/mentor24-maker/wavecenter/pull/134)
   - [86bcx2fyn](https://app.clickup.com/t/86bcx2fyn) "Admins cannot write or change the reason behind a factor score on Game → Manage" → [#136](https://github.com/mentor24-maker/wavecenter/pull/136)

3. > Great. However, I just noticed that some of the actions resulted in 0 scores. I want a floor of 1 point. Every single action scores something. Take a look at if it makes more sense to just set a hard floor or reconsider the algorithm so nothing results in a 0 score. What is farming risk?

   Led to: the decision that every action scores at least 1, and an explanation of farm risk. The choice between a hard floor and a new formula was settled in prompts 4 and 5.

4. > Re: farming, I was wondering if the farming quotient was being over-emphasized, resulting in the 0 scores in spite of other values. Check that theory. In time, we will be adding more sophisticated anti-farming behavior negative scores. So I'm not sure we have the need to lean so hard on the farming factor at this point. Thoughts?

   Led to: the theory checked and confirmed. 19 of 24 actions had F = 3, which worked as a flat −3 and also zeroed Rarity, and all six zero rows had F = 3. The recommendation was to drop F from the formula and keep it as data.

5. > I agree to all three. Drop F at this level.
   >
   > Now some more thoughts on weighting. We are currently working on granular tasks. These points will be augmented with all kinds of variations, each one of which ostensibly adds value. For example, 'create a task' could have lots of different factors that adjust the value of that task being created. It will fractal out. And generally speaking, as it fractals out, it will be getting into value-add, and bigger numbers. So the size of scores increase with the complexity of the engagment. This means that the granular points scored through the automated 'machine level' will be minimal to the totals scored through higher level engagement through the globular scores.
   >
   > So we don't need to nail it at this level. They just need to make sense relative to each other.
   >
   > Factor all that into the steps above. Also file a ticket to write documentation on this whole scoring system. We need an expandable wiki for this, as this is fundamental to the whole model, and as you can already see, it is going to be sprawling.

   Led to:
   - Decision: the formula is `1 + E + 2×V + R`; farm risk is scored but not counted ([docs/scoring/principles.md](scoring/principles.md), [docs/GRANULAR_SCORING_ALGORITHM.md](GRANULAR_SCORING_ALGORITHM.md)).
   - [86bcx2trm](https://app.clickup.com/t/86bcx2trm) "Six actions score 0 points because farm risk is subtracted too hard: drop farm risk from the formula so every action scores at least 1" → [#131](https://github.com/mentor24-maker/wavecenter/pull/131)
   - [86bcx2tt3](https://app.clickup.com/t/86bcx2tt3) "Members could farm points before anyone is invited: finishing the same task again and saving something unchanged still pay" → [#133](https://github.com/mentor24-maker/wavecenter/pull/133)
   - [86bcx2tte](https://app.clickup.com/t/86bcx2tte) "Nobody can learn how WaveCenter scoring works in one place: start a scoring wiki that can grow as the system does" → [#135](https://github.com/mentor24-maker/wavecenter/pull/135)
   - 86bcx2fyj rewritten for the new formula and moved behind 86bcx2trm.

6. > Working great. When points are adjusted, does it retroactiively change points earned in the past? In other words, are those scores calculated from the activity records in real-time, or recorded as they happen?

   Led to: an answer. Points are copied into the ledger when the action happens, so changing a rule never rewrites them ([docs/DATA_MODEL.md](DATA_MODEL.md), "engagements").

7. > I'd like to have the ability to retroactively readjust during the development phase when you aren't sure how many points anything is worth. I had left most of them at zero, and we had that farming weight. So all the work I did was decreased. (Not that I'm worried about it. Just thinking of future DEOs ramping up.)

   Asked whether ending the provisional phase should be permanent, Dane answered "Permanent (Recommended)".

   Led to:
   - [86bcxqz5v](https://app.clickup.com/t/86bcxqz5v) "Points earned under early guesswork values stay wrong forever: let an admin rescore past points to today's values while scoring is provisional" → [#142](https://github.com/mentor24-maker/wavecenter/pull/142)
   - [86bcxqz70](https://app.clickup.com/t/86bcxqz70) "Admins cannot declare a DEO's points final: add a one-way switch that ends provisional scoring" → [#145](https://github.com/mentor24-maker/wavecenter/pull/145)

8. > /doc-it

   Led to: [86bd1frf2](https://app.clickup.com/t/86bd1frf2) "Dane's prompts are not recorded: start the operator prompt log": this log, and a link from [docs/scoring/granular.md](scoring/granular.md) "Rescoring past points" to the one-way final switch.
