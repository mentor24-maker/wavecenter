## 2026-11-24 — Add Alerts section to header (#198)

Every signed-in page now has a small "Alerts" box in the header, between the
member's name line and the main menu. It answers "what needs me next?" at a
glance: how many chats have a new message, and how many of their own tasks are
still open (to do or in progress), each a link straight to where they act on
it. The message count updates the moment someone writes, without a reload.

When there is nothing waiting it says "No alerts", and if a count cannot be
read it shows "?" rather than a misleading 0, so an empty box never looks like
a broken one. The rule for what counts as an open task lives in WaveCenter's
core, with its own tests, so later screens can reuse it.

After review, the message count's words were corrected: it counts chats with
something unread, not single messages, so it now reads "1 chat with new
messages" rather than "1 new message" (three messages in one chat used to show
as "1 new message").
