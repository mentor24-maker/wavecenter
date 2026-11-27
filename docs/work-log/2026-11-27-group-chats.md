## 2026-11-27 — Let a Comm chat include more than two members (#224)

Until now every chat on Comm was between exactly two members. Now the
"Chat with" picker on Comm's Sync page is a tick-list: tick one member for
a private chat as before, or several to start a group chat with all of them
at once, up to 10 people counting yourself. Ticking the same people again
opens the group already there, so nobody ends up with duplicate groups.

In a group chat, the list and the heading name everyone else in it ("Ana,
Ben and Cal") under a group avatar, and every message names who sent it, so
a small group can tell who said what. Unread counts work for each member
the same way they do in a two-person chat: other people's messages count,
your own never do.

The rules (at least one other person, nobody twice, not yourself, no more
than 10) live in WaveCenter's core with tests, and the database repeats
them, refusing in plain words, so nothing can slip around the screen. The
old two-person way of starting a chat, used by the task page and the
Members page, now goes through the same rules. Starting a new chat still
earns its "Started a chat" point once; reopening one earns nothing.

Adding someone to a chat that already exists is the next ticket (WC-256).
