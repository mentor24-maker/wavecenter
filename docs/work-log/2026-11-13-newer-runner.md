## 2026-11-13 — WaveCenter's lanes ignore the Settings page and start Claude on every empty pass: bring them up to Spirality's runner (#169)

Dane set WaveCenter's wake times on the tracker's Settings page, but they did
nothing yet. WaveCenter's lanes ran on an old copy of Spirality's runner that
slept a fixed 30 minutes and started a Claude session on every pass, even
when there was nothing to do, and each of those sessions used up Claude
quota.

This copies in Spirality's newer runner, relay and ticket door, byte for byte,
from the Spirality version that skips empty passes (SP-292). Now the wake
times, pause switches, work-in-progress cap and model choices Dane sets for
WaveCenter take effect. When a lane's queue is empty it notes "SKIP" and goes
back to sleep without starting Claude.

WaveCenter's own lanes are kept: the hand-off lane, the AI rating lane and the
Evolution pictures lane. The hand-off lane stays on the older runner, because
the Settings page has no pause switch for it and the newer runner would treat
it as paused for good. The settings file gained the one version line
Spirality now requires.

This is a stopgap. The copy goes away once Spirality runs WaveCenter's lanes
from its own folder. After the merge, the lane installer is rerun on the Mac
Mini so the new timings load.
