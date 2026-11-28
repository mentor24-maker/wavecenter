## 2026-11-27 — Add a Latest Members module for website builder (#232)

Pages built in the website manager can now show a **Latest members** box,
the same one members see on Home: the five newest members, newest first,
each with their avatar, their name only if their profile shows it, and the
day they joined, then a link to everyone on the Members page. The only
setting is the heading above the list.

Who sees what is decided in one place, with tests, before anything is read.
A visitor who is not signed in sees only a note to sign in, never a name. A
role that may not view members is told so, as on Home, and anything that
could not be read or checked says so in a plain sentence instead of an empty
box.

Home's own box and the new module now share the same rule for "newest five",
so the two can never disagree. Home looks exactly as it did. No database
change was needed.
