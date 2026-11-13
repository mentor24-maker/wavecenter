## 2026-11-13 — Members cannot tell when a chat message is waiting: show unread count (#168)

A chat is only real-time if you know a message arrived. Until now, nothing on
WaveCenter said someone had written to you unless the chat window was already
open.

Now **Chat** in the header shows how many of your chats have a message
waiting: hidden when there are none, "9+" above nine. It updates by itself on
every page, within a second of the message being sent. In the chat list, each
chat with something unread is in bold with its count. Opening a chat clears
it, and so does each new message that arrives while you are looking at it.
Your own messages never count as unread for you.

Behind it, the database now remembers when each member last read each chat.
Only you can mark your own chats read, and the database refuses anyone else,
which the test database checks. Reading a chat earns no points: it is not an
engagement a member chooses.
