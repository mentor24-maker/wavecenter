## 2026-11-12 — Members cannot chat with each other yet: store live chat messages (#164)

Dane asked whether WaveCenter could have a real-time chat between two
members in a window of its own, with chats beside and about tasks. This is
the first piece: the storage a chat is built on. There is no chat screen yet;
the chat window is the next ticket in the series.

WaveCenter now keeps chats in three new tables: the conversations, who is
in each one, and the messages. They are private from the start. A member can
read a chat only if they are in it. Nobody else can read it, an admin
included, and nobody can change or delete a message. A chat can be about a
task, and the same two members always get the same chat back, whichever of
them starts it. That one-chat rule held even when the test fired three
starts at the same moment.

Every chat message earns its sender points through a new action, "Sent a
chat message". The scoring formula gives it 4, the same as a message to a
member. It is listed on Game → Manage with its four factor scores and the
reason for each. Messages are also wired up for live updates, so the coming
chat window can show a new message the moment it is sent.

All of this was tested on the private test database (300 checks, including
proof that a member outside a chat sees nothing of it). Game → Manage was
opened on that test copy to see the new row.
