## 2026-11-23 — Changed a Home box earns its point (#186)

Changing the words in a Home box now earns a point. Before this, "Changed a
Home box" was on Game > Manage but marked "Not active yet". The second sweep
of the app (WC-188) had listed it, but nothing recorded it.

Now, when a member saves new words in "What is WaveCenter" or "What is a
DEO", the database adds one "Changed a Home box" line to their points in the
same step that saves the words, so the two always land together. Some saves
earn nothing:

- **The same words saved again:** nothing changed.
- **A refused save:** only a role with Edit Home boxes may change the words.
- **A save made behind the scenes with the database's master key:** nobody
  is signed in to credit, so it earns nothing instead of failing.

The action also got its four factor scores, each with a one-line reason: a
short form, words every member reads, a few times a week at most, and a
change that can be undone straight away. The formula proposes 7 points, the
same as changing a scoring rule. The action stays at 1 point until an admin
puts the new values live from the Admin page, as for every other swept
action.
