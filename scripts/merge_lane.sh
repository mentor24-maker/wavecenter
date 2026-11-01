#!/bin/bash
# One pass of the merge lane: carry out Dane's written "merge" on Ready to
# launch tickets, requeue Needs your input tickets he has answered, then take
# the Evolution screenshot of each change that has none yet.
#
#   merge_lane.sh
#
# launchd runs this every 10 minutes (scripts/install_loop_runner.sh, label
# com.wavecenter.merge-on-comment). It is plain node under Doppler, no Claude
# session, so it costs no model usage. 10 minutes is StarCaster's interval for
# the same lane: a "merge" is the one instruction Dane waits on with the app
# open, and 30 minutes felt broken to him.
#
# launchd will not start a second copy of a job while one runs, so there is no
# lock. The other lanes pull main; this one runs whatever main they pulled.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[merge-lane] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi
LOG="$HOME/loop-logs/wavecenter-merge-on-comment.log"
mkdir -p "$HOME/loop-logs"
cd "$REPO" || exit 1

{
  echo ""
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /merge-on-comment ====="
  npm run --silent clickup -- merge-on-comment 2>&1
  CODE=$?
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /merge-on-comment (exit $CODE) ====="

  # The Evolution picture of every change on main that has none yet, so each
  # merge above gets its screenshot within one pass. It runs after the merges
  # and can never undo one: a failed picture is a `failed` row and one comment
  # on its ticket, never a status change. One capture measured 68 seconds on
  # the Mac Mini (315f909, 2026-10-31: install, build, rebuild the test
  # database, photograph, wipe). 360 seconds fits about five, and leaves the
  # merge step room inside the 10-minute interval; anything cut off at the
  # limit wrote no row, so the next pass retakes it.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /evolution-missing ====="
  "$REPO/scripts/run_with_time_limit.sh" 360 -- npm run --silent evolution -- missing 2>&1
  CODE=$?
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /evolution-missing (exit $CODE) ====="
} >> "$LOG" 2>&1
