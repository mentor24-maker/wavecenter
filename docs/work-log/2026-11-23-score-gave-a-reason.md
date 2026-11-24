## 2026-11-23 — Gave a reason for a factor earns its point (#189)

Writing why an action got one of its factor scores now earns a point.
Before this, "Gave a reason for a factor" was on Game > Manage but marked
"Not active yet". The second sweep of the app (WC-188) had listed it, but
nothing recorded it.

Now, when an admin writes, changes or clears the reason behind one of an
action's four factor scores (Effort, Value, Rarity, Farm risk) on Game >
Manage and saves, the database adds one "Gave a reason for a factor" line to
their points in the same step that saves the reason, so the two always land
together. Some saves earn nothing:

- **Saving the same reason again:** nothing changed, even if extra spaces
  were typed around it.
- **A refused save:** only an admin may write a reason, and one over 300
  characters is turned away.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

Changing an action's wording, points or factor scores are still their own
actions with their own points.

Its four factor scores, each with a one-line reason, are: one sentence
takes under a minute, every member can read why an action is worth what it
is, only an admin does it a few times a week, and a reason can be changed
straight back. The formula proposes 7 points. It stays at 1 point, as every
swept action does until an admin puts the formula's values live from the
Admin page.
