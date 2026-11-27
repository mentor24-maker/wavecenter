## 2026-11-26 — Correct out-of-date statements in DATA_MODEL.md and code comments (#218)

Five sentences in WaveCenter's notes still said a feature was "not built yet"
when it now exists: the place to read messages (Comm, under Async), a
member's profile page that other members can see (`/members/<id>`), the
leaderboard (`/game/leaderboard`), and the website editor and public pages
(`/site/<slug>`). Each sentence now names the screen that exists and where it
is described.

Why it matters: agent sessions read these notes to learn what is already
built. A stale "not built yet" could send one off to build the same thing a
second time. Nothing about how any screen works changed.

One similar sentence, about attaching tags to forum topics, was left alone
because it is outside this ticket; it is noted on the pull request.
