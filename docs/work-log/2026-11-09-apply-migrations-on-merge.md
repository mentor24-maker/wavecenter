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
