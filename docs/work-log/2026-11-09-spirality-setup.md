## 2026-11-09 — WaveCenter cannot run Spirality's loop yet: add its settings, verify check, ticket door, loop skills and lanes (#156)

Spirality's setup wizard copied its loop into WaveCenter: the settings file,
the `verify` check, the ticket door (`npm run clickup`), the loop skills and
the lanes the Mac Mini runs. Every ticket now lives in the tracker instead of
ClickUp.

Review sent the first version back because two WaveCenter features would
have stopped. This round fixes them:

- **WaveCenter's own commands have their own name again.** Making a task for
  Dane before a chat request is built (`chat-task`, `chat-record`) and the
  hand-off lane's commands (`handoff-next`, `handoff-record`, `handoff-sync`)
  are now `npm run wavecenter -- <command>`. They read tickets from the
  tracker. A task records its ticket as the tracker's public, signed-in
  page, because Dane's task screen only shows `https` links. Tasks handed
  off before the move still point at ClickUp, and the sync still reads those
  from ClickUp. CLAUDE.md and the hand-off skill name the new commands.
- **The AI rating lane is installed again**, every 30 minutes, beside
  Spirality's lanes. The installer has to be run again on the Mini after the
  merge.
- **The hand-off lane is not installed yet.** Spirality's runner signs each
  lane in to the tracker under that lane's own name, and there is no
  tracker sign-in for the hand-off lane. Dane chose to go ahead without it
  for now ("A"). Spirality ticket SP-180 gives extra lanes their own
  sign-in, and WaveCenter ticket WC-163 installs the hand-off lane once
  SP-180 and this pull request are in. Until then, tasks members tick for
  AI agents wait.
