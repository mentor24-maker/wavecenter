## 2026-11-12 — Task discussions need a refresh to show new comments: make them live (#165)

A task's Discussion is now a place two members can actually talk. Before, a
member saw only their own comments and could comment only on their own
tasks, and even their own new comments showed only after a page reload.

Dane chose who may do what (option A): every member reads every comment and
may post on any task, and each member edits and removes only their own.
The database rules changed to match, and a comment's attached files became
readable by every member the same way. Attaching files still works only on
your own tasks, and the screen says so.

The task page's Discussion now updates live. When anyone posts, edits or
deletes a comment, the other people looking at that task see it within about
a second, without reloading. If the live connection drops, the Discussion
says "Live updates paused, reload to see new comments", so a stale screen
never looks current. To do this the browser now holds Supabase's public key,
which is safe because the database's own rules decide what it can see. The
secret service key still never leaves the server. The new live-connection
helper is the one the coming chat window will reuse.

The database rules check gained live checks: a second member hears new
comments, edits and deletes, and a signed-out visitor hears nothing.

Review sent it back once, and the fix closed a quiet gap. Every time the
page refreshed to show a new comment, the live connection hung up and dialled
in again, and a comment that landed in that moment could be missed with
nothing on screen saying so. Now the connection stays open for the whole
visit (checked: one connection for five comments in a row, where before
there were five). Each time it does start listening, the Discussion reloads
once, so nothing said just before is missed. And if the connection is still
not working after about ten seconds, the "paused" line shows, instead of a
screen that looks current but is not.
