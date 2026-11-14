# loop/

The ticket door for WaveCenter: the commands a session uses to read and move
WaveCenter's tickets (`npm run clickup -- <command>`) and to check its keys and
repository (`npm run doctor`).

Every file here except this README is copied byte for byte from
[Spirality](https://github.com/mentor24-maker/spirality) at commit
`e5d86e4` (Spirality's SP-292, its PR #220; WC-177), the files and paths
Spirality's own copy list names (`scripts/onboard/manifest.json` at that
commit), keeping Spirality's layout (`scripts/` beside `lib/`) so no import
changes. The project settings it reads are WaveCenter's own
`spirality.project.json` at the repository root, written to Spirality's
manifest version 2 (`docs/PROJECT_MANIFEST.md` in Spirality).

Do not edit these files here. A change is made in Spirality first, then
copied in by Spirality's setup wizard (`npm run onboard:copy`) from a newer
commit. `npm run test:loop` runs the copied tests.

## The runner scripts

The loop jobs on the Mini are run by files copied from the same Spirality
commit. They live in the repository's own `scripts/`, not here, because each
one finds the project's folder from where it sits: `loop_runner.sh`,
`run_relay.sh`, `pause_check.sh`, `work_check.sh`, `run_with_time_limit.sh`,
and in `scripts/lib/` `loopSchedule.mjs`, `wakeSetting.mjs`,
`modelSetting.mjs`, `laneModels.mjs`, `workCheck.mjs`, `claudeTrust.mjs`,
`gh_auth.sh`, `launchd_reload.sh`, `back_to_main.sh`, `tracker_restart.sh`,
`relay_app_checks.sh` and `trackerFiles.mjs`. All are byte for byte except
`scripts/project_config.mjs` and `scripts/lib/trackerFiles.mjs`, which import
`../loop/lib/projectConfig.mjs` instead of `../lib/projectConfig.mjs` (the
two edits Spirality's copy list makes itself).

With them, the wake times, pause switches, work-in-progress cap and model
choices set for WaveCenter on the tracker's Settings page take effect, and a
lane with nothing to do skips its Claude session.

Two runner files are WaveCenter's own and are not straight copies:

- `scripts/install_loop_runner.sh` is Spirality's installer from `e5d86e4`
  with WaveCenter's own lanes added: loop-handoff, ai-rating and evolution.
- `scripts/project_lane_runner.sh` is Spirality's older runner from `418fe69`
  byte for byte, the one every WaveCenter lane ran on before WC-177. Only
  loop-handoff runs on it. The Settings page has no switches for that lane, and
  the newer runner treats a lane with no pause switch as paused, so it keeps
  its fixed ten-minute timer as before.

Spirality's tests for the new helpers (`wakeSetting`, `modelSetting`,
`workCheck`, `pauseCheck`) are not copied: they import Spirality's own
tracker code and test helpers, which WaveCenter does not have, and Spirality's
copy list leaves them out for that reason.

This whole copy is a stopgap. It is removed when Spirality runs WaveCenter's
lanes from its own folder (Spirality's SP-273 and SP-276, then WaveCenter's
own remove-the-copy ticket).
