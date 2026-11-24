## 2026-11-23 — Made a proposal earns its point (#183)

Making a proposal now earns a point. Before this, "Made a proposal" was on
Game > Manage but marked "Not active yet": the second sweep of the app
(WC-188) had listed it, but nothing recorded it.

Now, whenever a member makes a proposal, the database adds one "Made a
proposal" line to their points in the same step that saves the proposal,
so the two always land together. A proposal that is refused (a blank title,
or one put in another member's name) earns nothing, because nothing was
saved. A proposal made behind the scenes with the database's master key has
nobody to credit, so it earns nothing instead of failing. Changing or
deleting a proposal are separate actions with their own tickets, so they
are not counted here.

The action also got its four factor scores and a one-line reason for each
(a short form, an idea the other members can read that could become a
task, something members can do many times a day, and it can loop because a
proposal can be deleted and made again). The formula proposes 6 points, the
same as making a task. It stays at 1 until an admin puts the new values
live from the Admin page, the same way as for every other swept action.

After review, one safety catch was tightened: when the update fills in those
reasons, it now only writes a reason where an admin has not already typed
one on Game > Manage, so nothing an admin wrote can be quietly replaced. The
data model's note on proposals now says making one is scored, and the
database check no longer claims a test that could not actually fail.
