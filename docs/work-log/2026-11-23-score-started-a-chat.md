## 2026-11-23 — Started a chat earns its point (#180)

Starting a chat with another member now earns a point. Before this,
"Started a chat" was on Game > Manage but marked "Not active yet": the
second sweep of the app (WC-188) had listed it, but nothing recorded it.

Now, whenever a member starts a chat that did not exist before, the
database adds one "Started a chat" line to their points, in the same step
that saves the chat, so the two always land together. Opening a chat that
already exists earns nothing, because nothing new was made. A chat made
behind the scenes with the database's master key has nobody to credit, so
it earns nothing instead of failing.

The action also got its four factor scores and a one-line reason for each
(one click, helps one other member, a few times a week, cannot loop
because chats are never deleted). The formula proposes 4 points. It stays
at 1 until an admin puts the new values live from the Admin page, the
same way as for every other swept action.
