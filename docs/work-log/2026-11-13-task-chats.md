## 2026-11-13 — Members cannot chat privately about a task: link a chat to it (#167)

Dane asked for chats "next to and about tasks". Every task page now has a
**Chat about this task** panel beside its details. A member picks anyone
(the task's maker comes first), starts or reopens a private chat about the
task, and reads it live right there. Only the two members in a chat can see
it, and the panel says so, so nobody mistakes it for the public Discussion.

In the Chat window, a chat about a task now shows the task's title as a
link. If the task was deleted, the chat says "about a deleted task".

To make that last part possible, the database now remembers, for each chat,
whether it was started about a task. Before, deleting a task left its chats
looking exactly like ordinary chats, and starting an ordinary chat with the
same member could have reopened the old task chat by mistake. That is fixed
too. Tested on the private test database, never the live one.
