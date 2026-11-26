## 2026-11-26 — Test database repairs itself after a worktree is deleted (#212)

The Mac Mini keeps a private test database (in Docker) that every change's database work is tried on, and that Evolution pictures are taken against. Earlier today it stopped answering for about four hours: one of its pieces, the "front door" (Kong), had been started from a temporary work folder and borrowed a file from it. When that folder was tidied away, the front door could not start again.

Now the test database is always started from the main folder, so it never borrows from a temporary one. And before `npm run db:test` or an Evolution picture uses it, it is checked: if a piece is stopped, a borrowed file is gone, or it does not give its address, it is restarted once from the main folder and checked again. If it still does not answer, the message says exactly which piece is stopped and which file is missing.

This was tried for real on the Mini: the breakage was recreated on purpose, and `npm run db:test` noticed, restarted it, and passed.
