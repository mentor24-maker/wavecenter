## 2026-11-23 — Added a token size earns its point (#190)

Adding a token size now earns a point. A token size sets how big and what
colour the earned-points discs are. Before this, "Added a token size" was on
Game > Manage but marked "Not active yet". The second sweep of the app
(WC-188) had listed it, but nothing recorded it.

Now, when an admin adds a new token size on Game > Manage, the database adds
one "Added a token size" line to their points in the same step that saves
the size, so the two always land together. Some saves earn nothing:

- **A refused save:** only an admin may add a size, and a size that breaks
  the rules (a point level another size already uses, a size out of range,
  a colour that is not a hex code) is turned away.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

Changing a size and removing one are separate actions, each with its own
ticket.

It has four factor scores, each with a one-line reason: the form takes
under a minute, every member's tokens use the sizes, sizes are set only a
handful of times ever, and a size can be added and removed straight back.
The formula proposes 8 points. It stays at 1 point, like every swept
action, until an admin puts the formula's values live from the Admin page.
