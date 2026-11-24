## 2026-11-23 — Changed a proposal earns its point (#184)

Changing a proposal now earns a point. Before this, "Changed a proposal"
was on Game > Manage but marked "Not active yet": the second sweep of the
app (WC-188) had listed it, but nothing recorded it.

Now, whenever a member saves a change to one of their proposals (its title,
notes, points, priority, status or the proposal it sits under), the database
adds one "Changed a proposal" line to their points in the same step that
saves the change, so the two always land together. A save that changes
nothing, or only moves the proposal up or down the list, earns nothing. A
change that is refused (a blank title, or someone else's proposal) earns
nothing, because nothing was saved. A change made behind the scenes with the
database's master key has nobody to credit, so it earns nothing instead of
failing. And when a proposal is deleted, the proposals under it lose their
parent automatically; that is part of the delete, not a change anyone made,
so it earns nothing either.

The action also got its four factor scores and a one-line reason for each
(a short form, it keeps a proposal accurate, members can do it many times a
day, and any edit can be changed straight back). The formula proposes 4
points, the same as changing a task. It stays at 1 until an admin puts the
new values live from the Admin page, the same way as for every other swept
action.
