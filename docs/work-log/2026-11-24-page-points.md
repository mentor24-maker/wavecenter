## 2026-11-24 — Website manager: making and publishing pages earns game points (#201)

Website work now earns points, like every other thing a member does in
WaveCenter. Making a new page in the website manager earns "Made a page",
and turning a draft page into a published one earns "Published a page",
1 point each to start. Both are listed on Game → Manage with their four
factors left blank, so an admin can score what they are really worth.

The database writes the point in the same step as the page itself, so the
two can never disagree: a refused save, a rename, or saving a page that is
already published earns nothing, and a change made with the server's master
key earns nobody anything. Five new database checks prove it on the test
database, and a walk through the real screens showed the credit arrive on
Game → My Points.
