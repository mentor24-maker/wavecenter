#!/bin/bash
# One pass of the Evolution lane: take the Evolution picture of each change
# on main that has none yet, then retake the old ones when a merge changed
# the rules that choose them.
#
#   evolution_lane.sh            # one pass (what launchd runs)
#   evolution_lane.sh --once     # one pass, its output printed here too
#
# launchd runs this every 10 minutes (scripts/install_loop_runner.sh, label
# com.wavecenter.evolution). Until the move to Spirality's loop (WC-162) these
# steps ran in WaveCenter's merge lane, right after each merge. Spirality's
# relay merges now and runs no step of WaveCenter's own, so the pictures have
# their own lane on the relay's interval: a merge gets its picture within a
# pass or two (WC-165). It is plain node under Doppler, no Claude session, so
# it costs no model usage.
#
# launchd will not start a second copy of a job while one runs, so there is
# no lock. The build and review lanes pull main; this one runs what they
# pulled. The capture takes the test database's own lock for each picture.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[evolution] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi
cd "$REPO" || exit 1
SLUG="$(node "$REPO/scripts/project_config.mjs" projectSlug)" || { echo "[evolution] could not read projectSlug from the project config" >&2; exit 1; }
LOG_DIR="$(node "$REPO/scripts/project_config.mjs" logDir)" || { echo "[evolution] could not read logDir from the project config" >&2; exit 1; }
LOG="$LOG_DIR/$SLUG-evolution.log"
mkdir -p "$LOG_DIR"

# The tracker seat this lane signs in as, to read a ticket for Dane's words
# and to post a failed picture's note: the relay's, whose merges these
# pictures follow. Only the secret's name, never its value.
export TRACKER_TOKEN_NAME=TRACKER_TOKEN_RELAY

{
  echo ""
  # The Evolution picture of every change on main that has none yet. It can
  # never undo a merge: a failed picture is a `failed` row and one comment on
  # its ticket, never a status change. One capture measured 68 seconds on the
  # Mac Mini (315f909, 2026-10-31: install, build, rebuild the test database,
  # photograph, wipe). 360 seconds fits about five, and with the retake below
  # stays inside the 10-minute interval; anything cut off at the limit wrote
  # no row, so the next pass retakes it.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /evolution-missing ====="
  "$REPO/scripts/run_with_time_limit.sh" 360 -- npm run --silent evolution -- missing 2>&1
  CODE=$?
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /evolution-missing (exit $CODE) ====="

  # When a merge changed the picture rules (scripts/lib/evolution.mjs), retake
  # the old cards those rules now picture differently, so Dane sees the fix on
  # Home without a session remembering to run it (2026-11-01: a rules fix went
  # Live with every card unchanged). Unchanged rules retake nothing and cost
  # one file read. Only after a clean `missing`: a broken run would break this
  # the same way, and new changes get their first picture before old ones are
  # redone. 180 seconds fits two retakes; one cut off at the limit leaves its
  # old card, and the next pass carries on from there (cards already retaken
  # are skipped). A run that keeps being cut off without retaking anything
  # tells the rules change's ticket once, as a failure does.
  if [ "$CODE" -eq 0 ]; then
    echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /evolution-recapture ====="
    "$REPO/scripts/run_with_time_limit.sh" 180 -- npm run --silent evolution -- recapture --if-rules-changed 2>&1
    CODE=$?
    echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /evolution-recapture (exit $CODE) ====="
  fi
} 2>&1 | if [ "$ONCE" = 1 ]; then tee -a "$LOG"; else cat >> "$LOG"; fi
