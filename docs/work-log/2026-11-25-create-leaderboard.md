## 2026-11-25 — Create Leaderboard (#208)

Game → Leaderboard used to be a placeholder sentence. It is now a real
table that ranks every member by their points, with the four scores Dane
asked for: **Granular** (the small points earned for each action, the same
number My Points shows), **Globular** (the points on tasks they have
finished), **Tasks** (how many tasks they have finished) and **Total**
(Granular plus Globular). The member looking at the board sees their own
row tinted and marked "(you)", and members with the same Total share a rank.

Privacy comes first. Each member can normally see only their own points, so
the board reads everyone's numbers through one new database function that
hands back totals and nothing else: no account ids, no bios, no single
actions. A member whose profile is not Public appears as "Anonymous member",
and their name never leaves the database. Signed-out visitors cannot read
it at all. New checks on the private test database prove each of these.

Names are not clickable yet: no page shows one member's profile to another,
so Dane chose to ship the board now and build that profile page as its own
ticket.
