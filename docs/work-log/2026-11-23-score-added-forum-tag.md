## 2026-11-23 — Added a forum tag earns its point (#182)

Adding a tag on the Forum now earns a point. Before this, "Added a forum
tag" was on Game > Manage but marked "Not active yet": the second sweep of
the app (WC-188) had listed it, but nothing recorded it.

Now, whenever a member adds a tag, the database adds one "Added a forum
tag" line to their points in the same step that saves the tag, so the two
always land together. A tag that is refused (its name is already on the
list, or blank) earns nothing, because nothing was saved. A tag made behind
the scenes with the database's master key has nobody to credit, so it earns
nothing instead of failing. Adding a topic is a separate action with its
own ticket, so it is not counted here.

The action also got its four factor scores and a one-line reason for each
(a short form, a label for sorting the Forum that is not yet attached to
topics, a few times a week, and it cannot loop yet because a tag cannot be
deleted). The formula proposes 5 points. It stays at 1 until an admin puts
the new values live from the Admin page, the same way as for every other
swept action.
