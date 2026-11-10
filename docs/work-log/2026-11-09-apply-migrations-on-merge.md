## 2026-11-09 — Merged database changes will not reach the live database: apply them (#160)

When WaveCenter moved onto Spirality's loop, one step got lost. Before, when
Dane wrote `merge` on a pull request that changes the database, the merge
step first applied that change to the live database, and merged nothing if it
failed. The new relay just merged. So a database change could reach `main`
while the live database stayed as it was, and any screen needing it would
break. Until now, the review lane held every such pull request back.

Spirality added a place for a project's own step just before a merge
(SP-185). This change copies that update in and plugs WaveCenter's database
step into it: on Dane's `merge`, it reads the pull request's new database
files from the exact version about to merge, applies them to the live
database, checks the database now lists them, and only then lets the merge
happen. If anything goes wrong, nothing is merged, the ticket says why, and
the relay tries again on its next pass. Pull requests with no database
change never touch the database.

It was tested on the private test database on the Mac Mini, never the live
one: a good change applied and was read back, a broken one was refused and
left nothing behind, and running it twice was harmless. The review lane no
longer holds database changes back.

**Fixed after review.** The review lane caught that the relay starts the
database step from inside WaveCenter's `loop/` folder (where its copy of
Spirality's code lives), not from the top of the project, so it could not
find the step and would have refused every merge, database change or not.
The setting now points one folder up (`../scripts/apply_migrations.mjs`),
and a new test reads the relay's own code to work out which folder it starts
from and fails if the path ever stops lining up. Run the way the relay runs
it, the step now says "Database: this PR has no database change." and lets
the merge go ahead.

The step also now has its own five-minute limit. The relay gives a step up to
ten minutes, but WaveCenter's relay pass is stopped at eight, and a pass
stopped from outside leaves no note on the ticket. With its own limit, a slow
apply stops itself, merges nothing, and says on the ticket that it ran out of
time. A database change normally applies in a few seconds.

One known gap, in Spirality's part: if the database change applies and the
merge itself then fails (for example, a new push landed in between), the
ticket says only that the pull request "could not be merged", not that the
live database already changed. The next pass sees the change already applied
and merges normally; the wording is Spirality's to improve.
