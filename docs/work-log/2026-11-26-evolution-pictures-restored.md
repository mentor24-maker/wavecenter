## 2026-11-26 — Evolution pictures have stopped: the Mac Mini cannot take them (#211)

**What was wrong.** From about 8:36 this morning, every ten-minute pass of the
Evolution lane (the one that photographs each merged change for the Home
"Evolution of WaveCenter" row) failed with "the test database is not
reported". Merges were never affected; only the pictures stopped.

**Why.** The test database on the Mac Mini runs as a set of Docker
containers. One of them, Kong (the test database's web front door), had been
created while a build session was working in a temporary worktree folder, so
it read one of its files (the password-reset email template) from that
folder. When the folder was cleaned up after its pull request merged, Kong
could no longer start, and without Kong the test database has no address.

**What fixed it.** The build lane stopped the test database and started it
again from the main checkout, so every container now reads its files from the
folder that never goes away. Then `npm run db:test` passed and
`npm run evolution -- missing` took the one missing picture (Create
Leaderboard Module) and exited cleanly.

**So it cannot happen again.** No code changed here. The lasting fix, making
the test database notice and repair this on its own, is its own ticket:
WC-240, "Test database repairs itself after a worktree is deleted".
