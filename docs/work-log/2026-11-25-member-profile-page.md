## 2026-11-25 — Member profile page, linked from leaderboard names (#209)

Names on Game → Leaderboard are now links. Click a member's name and their
profile opens on a page of its own, which is what Dane asked for on the
Leaderboard ticket and put off to this one.

The page only shows what each member has chosen to show. A Public member's
page shows their avatar, name and bio. An Anonymous member's page shows
just the avatar. A Private member's page shows nothing, and neither does an
address that matches no member. Both of those say the same thing, so nobody
can use the page to find out whether a hidden member exists. Only Public
names on the leaderboard are links. The database never sends the page an
Anonymous or Private member's id, so there is nothing to link to and
nothing to give them away.

The database itself enforces this through a new function that hands over
only the fields a member allows. Tests on the test database check every
case, including the one where a Private member looks at their own page.
