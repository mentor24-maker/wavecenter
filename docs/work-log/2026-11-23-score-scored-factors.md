## 2026-11-23 — Scored an action's factors earns its point (#188)

Giving an action its factor scores now earns a point. Before this,
"Scored an action's factors" was on Game > Manage but marked "Not active
yet". The second sweep of the app (WC-188) had listed it, but nothing
recorded it.

Now, when an admin changes any of an action's four factor scores (Effort,
Value, Rarity, Farm risk) on Game > Manage and saves, the database adds one
"Scored an action's factors" line to their points in the same step that
saves the scores, so the two always land together. Some saves earn nothing:

- **Saving the same four scores again:** nothing changed.
- **A refused save:** only an admin may score an action, and scores out of
  range are turned away.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

Changing an action's wording or points, and writing why it got a score,
are still their own actions with their own points.

Its four factor scores, each with a one-line reason, are: about a minute's
thought, it shapes what every action is proposed to be worth, only an admin
does it a few times a week, and it can be changed straight back. That is
the same as changing a scoring rule, and the formula proposes 7 points. It
stays at 1 point, as every swept action does until an admin puts the
formula's values live from the Admin page.
