## 2026-11-23 — Deleted a token size earns its point (#192)

Token sizes are the earned-points tokens' sizes and colours that an admin
sets on Game > Manage. Deleting one was listed as an action by the second
sweep of the app, but nothing recorded it, so it showed "Not active yet" and
earned nothing.

Now the database itself records one "Deleted a token size" point for the
admin who deletes a size, naming the tool they used, in the same step as the
delete: both happen or neither does. A delete made by WaveCenter's own
maintenance (with no one signed in) still works and scores nobody, so a
clean-up never hands out points.

The action's four scoring factors are filled in (one click; tidies up the
sizes everyone's tokens use; admin only; the undo half of an add-and-delete
loop), giving a formula value of 4. It stays at 1 point until an admin puts
the formula's value live from the Admin page, like every other swept action.

Checked on the private test database: each delete scores once, the
maintenance delete scores nothing, and nobody can write the point
themselves. Game > Manage shows the row as Active.
