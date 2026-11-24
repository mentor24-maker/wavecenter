## 2026-11-23 — Deleted a proposal earns its point (#185)

Deleting a proposal now earns a point. Before this, "Deleted a proposal"
was on Game > Manage but marked "Not active yet": the second sweep of the
app (WC-188) had listed it, but nothing recorded it.

Now, whenever a member deletes one of their own proposals, the database adds
one "Deleted a proposal" line to their points in the same step as the
delete, so the two always land together. If a delete is refused (someone
else's proposal), nothing is deleted and nothing is earned. The proposals
that sat under a deleted one stay where they are, with no parent; they were
not deleted, so they earn nothing. A delete made behind the scenes with the
database's master key has nobody to credit, so it earns nothing instead of
failing. And when a member's whole account is deleted, their proposals go
with it; nobody chose to delete those, so they earn nothing either. (A test
showed that without this rule, a member deleting their own account would
have failed outright.)

The action also got its four factor scores and a one-line reason for each,
the same as deleting a task: one click, it tidies up the Proposals page,
members can do it many times a day, and it is the undo half of making a
proposal. The formula proposes 3 points. It stays at 1 until an admin puts
the new values live from the Admin page, the same way as for every other
swept action.
