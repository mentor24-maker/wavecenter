## 2026-11-26 — Create Leaderboard Module (#210)

A page built in the website manager can now hold a **Leaderboard** module,
beside headings, text, pictures and buttons. It shows the top ten members
from the Game leaderboard, each with just their rank, name and total points,
and a link to the full leaderboard.

It uses exactly the same ranking as the full page, so the two never
disagree, and members whose profile is not Public still show as "Anonymous
member". Because website pages are open to anyone on the web, Dane chose
that a visitor who is not signed in sees no names and no scores at all, only
a note to sign in. If the leaderboard cannot be loaded, or nobody has any
points yet, the module says so instead of going blank.

**After review (rework 1).** Review found one hole: if WaveCenter's check of
whether you are signed in fails (a hiccup reaching the sign-in service), the
module told a signed-in member "Sign in to see the leaderboard", which is
wrong and confusing. Now it says plainly that WaveCenter could not check
whether you are signed in and to try again in a minute, the same words the
full leaderboard page uses. The rule that decides this lives in the core
with its own tests, so the public page and the editor's preview both follow it.
