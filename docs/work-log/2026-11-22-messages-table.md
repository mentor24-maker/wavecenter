## 2026-11-22 — On Profile > Messages, places messages in CRUD table (#172)

Messages on Your profile used to be a plain list of subjects, which gets hard
to use once a member has more than a handful. It is now a table, like the
Members page: Direction, Member, Subject, Sent and Actions columns. Click a
heading to sort by it (newest first to start), and use the filter bar to
search by name, subject or message text, show only received or sent
messages, show only starred ones, or show the trash.

Each row has three buttons. **Reply** opens Send Message already addressed
to the other member, with "Re:" in front of the subject. **Star** is the
"Flag" from the ticket, renamed because Dane said it should mean
"important", not "bad". **Trash** hides a message from your own table; tick
Show trash to see it and Restore it. Dane chose to keep Star and Trash
private: the other member sees no change, and no message is ever deleted.

Behind the scenes there is one new database table for each member's stars
and trash, with its privacy rules switched on from the start, so nobody can
read or change anyone else's. If a Star or Trash fails to save, the row says
so and goes back to how it was. Tested on the private test database and
clicked through on the real page before handing over.
