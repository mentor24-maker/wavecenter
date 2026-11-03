# Anti-farming

[← Scoring wiki](README.md)

**Farming** means doing something over and over just to collect points,
not because it helps anyone.

## Why it matters

The canon names the danger. Platforms that "minted rewards for activity
itself" died of "engagement inflation"; the DEO's defence includes a
valuation repository that lets the membership "continuously reprice forms
of engagement, deflating any category being farmed", and reputation
weighting so "low-quality volume earns commensurate tokens"
(`docs/canon/deo-whitepaper.md`, "Failure Modes and Their Defenses"). It
also says "the same machinery that credits constructive contribution debits
toxic or manipulative behavior" (canon, "Engagement and Intelligence").

## The gap today

The granular formula does not stop loops: every action, looping or not,
pays at least 1 each time round (`docs/GRANULAR_SCORING_ALGORITHM.md`,
"Safeguards the formula cannot give"). Each action's **farm risk** is scored
and stored for this work, but does not change its points (see
[Granular scoring](granular.md)).

## The plan, in stages

### Stage 1: close the easiest loops before members are invited

The ticket "Members could farm points before anyone is invited: finishing
the same task again and saving something unchanged still pay" (pull request
#133, in review on 2026-11-03, not merged) does two things:

- **Finishing the same task again is not a second finish.** Only the first
  time a task becomes done scores "Finished a task"; finishing it again
  counts as "Changed a task".
- **Saving something unchanged records nothing**, for a task, a profile and
  the AI agents switch.

A third safeguard is named but not part of that ticket: **an undo takes
back what its action earned**, so a make-and-delete loop earns 0
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "Safeguards the formula cannot
give"). Whether to build it is Dane's call.

### Stage 2: negative scores for behaviour

Dane, 2026-11-02: "In time, we will be adding more sophisticated
anti-farming behavior negative scores. So I'm not sure we have the need to
lean so hard on the farming factor at this point."
(`docs/GRANULAR_SCORING_ALGORITHM.md`, "Why farm risk is not in the
formula").

Nothing about this stage is designed yet. See
[Open questions](open-questions.md).

### Later: the canon's own defences

Members voting on what each action is worth, reputation weighting, and AI
auditing of the ledger "for collusion and Sybil patterns", always subject
to human override (canon, "Failure Modes and Their Defenses" and
"Operations and Infrastructure").
