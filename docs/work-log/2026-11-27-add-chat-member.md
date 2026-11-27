## 2026-11-27 — Let a chat member add one more person to a chat (#226)

Anyone already in a Comm chat can now bring one more member into it. The open
chat has an "Add someone" button that lists the members not in the chat yet.
Pick one and they join: the chat's heading names them, the chat appears in
their own list with every earlier message, and it shows as unread for them
until they open it. A two-person chat can grow into a group this way, so a
conversation no longer has to start over when a third person is needed.

The rules live in one place and the database repeats them: only someone
already in a chat may add a person, nobody can be added twice, and a chat
holds at most 10 members. Someone outside a chat cannot use this to get into
it, whether from the screen or straight through the database, and two
members adding at the same moment can never push a chat past 10. Adding
someone does not earn points; that would be its own ticket.
