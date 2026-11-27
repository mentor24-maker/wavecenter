## 2026-11-26 — Add Dates filter on main Comm page (#219)

On Comm's Sync page, the **From:** and **To:** date pickers moved up to the
top row, to the left of **Chat with**, and the "Chat with" dropdown got
narrower so everything fits on one line.

Beside them is a new **Dates filter** choice, as Dane asked ("Provide a
toggle"): the dates can narrow the open chat's **Messages** (as before), the
**Chat list** on the left (by when each chat last had a message), or
**Both**. The days are counted in Mountain time and include both ends.

The chat list now explains itself when dates are set: how many chats it is
showing, a plain note when no chat falls between the dates, and a note when
the From day is after the To day. A "Clear dates" link brings everything
back. The task page's own chat panel looks exactly as before.

The dates and the Dates filter choice stay put while you open one chat after
another, so a chat list narrowed by dates no longer springs back to showing
every chat the moment you click one (the first review caught that). They
last for your visit to Comm and are forgotten on a reload.

Nothing is saved and nothing new is read from the database: the filter just
hides what is already on the screen.
