#!/bin/bash
# One pass of the merge lane: carry out Dane's written "merge" on Ready to
# launch tickets, and requeue Needs your input tickets he has answered.
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
} >> "$LOG" 2>&1
