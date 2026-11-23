## 2026-11-22 — Update the Game> Manage page (#174)

Game > Manage's list of "Actions that earn points" had not been updated
since 2026-11-02, and WaveCenter has grown a lot since then: chats, the
Forum's topics and tags, proposals, the Home page's boxes, starring
messages, and new scoring tools for admins. This went through every place
in the app where a screen saves something and checked each one against the
list.

Fifteen actions were missing, and now they are on the list: starting a chat;
adding a forum topic or tag; making, changing or deleting a proposal;
changing a Home box; starring a message; scoring an action's factors and
giving a reason for one; adding, changing or deleting a token size;
rescoring past points; and making points final. Each is worth 1 point and
says "Not active yet", which means nothing counts it so far and it earns
nothing. That is the same approach Dane chose for the first sweep: each one
gets its own small ticket (WC-189 to WC-203) that switches it on, and those
tickets wait until this one is merged.

Some saves were left off on purpose, and the pull request says why for each
one: signing in and out, password resets, marking a chat read, and
unstarring or binning a message are housekeeping rather than contributing,
and a point for each would be easy to farm. Nothing that was already on the
list changed.
