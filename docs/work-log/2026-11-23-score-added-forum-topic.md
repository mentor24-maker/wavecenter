## 2026-11-23 — Added a forum topic earns its point (#181)

Adding a topic on the Forum now earns a point. Before this, "Added a forum
topic" was on Game > Manage but marked "Not active yet": the second sweep
of the app (WC-188) had listed it, but nothing recorded it.

Now, whenever a member adds a topic, the database adds one "Added a forum
topic" line to their points in the same step that saves the topic, so the
two always land together. A topic that is refused (its name is already on
the list, or blank) earns nothing, because nothing was saved. A topic made
behind the scenes with the database's master key has nobody to credit, so
it earns nothing instead of failing. Adding a tag is a separate action with
its own ticket, so it is not counted here.

The action also got its four factor scores and a one-line reason for each
(a short form, gives members something to discuss, a few times a week, and
it can loop because a topic can be deleted and added again). The formula
proposes 7 points, the same as making a team. It stays at 1 until an admin
puts the new values live from the Admin page, the same way as for every
other swept action.
