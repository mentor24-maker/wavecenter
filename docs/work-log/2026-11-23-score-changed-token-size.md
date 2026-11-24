## 2026-11-23 — Changed a token size earns its point (#191)

Changing a token size now earns a point. A token size sets how big and what
colour the earned-points discs are. Before this, "Changed a token size" was
on Game > Manage but marked "Not active yet". The second sweep of the app
(WC-188) had listed it, but nothing recorded it.

Now, when an admin saves a change to a token size on Game > Manage, the
database adds one "Changed a token size" line to their points in the same
step that saves the change, so the two always land together. Some saves earn
nothing:

- **A save that changes nothing:** the name, size, colour and point level are
  all as they were, so nothing was really changed.
- **A refused save:** only an admin may change a size, and a size that breaks
  the rules (a point level another size already uses, a size out of range)
  is turned away.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

Adding a size and removing one are separate actions, each with its own
ticket.

It has four factor scores, each with a one-line reason: the form takes under
a minute, every member's tokens use the sizes, an admin may tune a size
several times while setting up, and a size can be changed and changed
straight back. The formula proposes 7 points. It stays at 1 point, like
every swept action, until an admin puts the formula's values live from the
Admin page.
