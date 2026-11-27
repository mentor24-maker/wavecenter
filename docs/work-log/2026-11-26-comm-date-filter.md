## 2026-11-26 — Add date filter on Comm > Discussion (#216)

On Comm's Discussion panel, the "Search this chat" box got smaller and two
date pickers, **From:** and **To:**, now sit beside it. Pick one or both
and the chat shows only the messages sent on those days, counted in
Mountain time so they match the day headings in the chat. Both ends count:
"To Nov 1" still includes a message sent at 11:30 PM on Nov 1.

Words and dates work together, so "hello" from Nov 2 shows only the
messages after Nov 1 that say "hello". The line above the messages says
which dates it is showing, and when nothing is found it says so with the
dates named. If the From day is after the To day, a short note explains
that instead of showing an empty box.

Nothing is saved and nothing new is read from the database: the chat's
messages are already on the screen, and the filter just hides the ones
outside the dates.
