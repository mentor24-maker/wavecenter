## 2026-11-23 — Starred a message earns its point (#187)

Putting a star on a message now earns a point. Before this, "Starred a
message" was on Game > Manage but marked "Not active yet". The second sweep
of the app (WC-188) had listed it, but nothing recorded it.

Now, when a member clicks the Star on a message in Your profile > Messages,
the database adds one "Starred a message" line to their points in the same
step that saves the star, so the two always land together. Some clicks earn
nothing:

- **Taking a star off, or starring a message that is already starred:** no
  new star.
- **Putting a message in the trash or taking it back out:** that is not a
  star.
- **A refused star:** a member can only star a message they sent or
  received.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

Taking a star off and putting it back does count again. That is why the
action got the highest "farm risk" score: it is easy to repeat just for the
points. Its four factor scores, each with a one-line reason, are: one click,
a private mark nobody else sees, done many times a day, and it loops. The
formula proposes 1 point, the same as switching the AI agents on or off, and
it stays at 1 point, as every swept action does until an admin puts the
formula's values live from the Admin page.
