#!/bin/bash
# One pass of the AI rating lane: rate up to 10 open tasks that need it,
# through Claude Code signed in with Dane's monthly Claude plan, and leave a
# report the Admin page reads (scripts/rate_tasks.mjs).
#
#   rating_lane.sh            # one pass (what launchd runs)
#   rating_lane.sh --once     # one pass, its output printed here too; may run from a worktree
#
# launchd runs this every 30 minutes (scripts/install_loop_runner.sh, label
# com.wavecenter.ai-rating). Dane chose the Mini on 2026-11-04 ("go with the
# Mini"), so ratings use his plan, never the API account. Doppler gives the
# pass only the two Supabase secrets (`npm run rate-tasks`), so no
# ANTHROPIC_API_KEY can reach Claude Code, and the pass refuses to start if
# one is set anyway.
#
# launchd will not start a second copy of a job while one runs, so there is
# no lock. The build and review lanes pull main; this one runs what they pulled.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$ONCE" = 0 ] && [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[ai-rating] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi
LOG="$HOME/loop-logs/wavecenter-ai-rating.log"
PASS_OUT="$(mktemp -t wavecenter-rating)"
trap 'rm -f "$PASS_OUT"' EXIT
mkdir -p "$HOME/loop-logs"
cd "$REPO" || exit 1

# A working pass of 10 tasks, two models each, two calls at a time, takes
# about 5 to 10 minutes. One still running at 15 minutes is stopped; anything
# it had not saved is rated on the next pass.
LIMIT="${RATING_PASS_LIMIT_SECONDS:-900}"

{
  echo ""
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /ai-rating (time limit ${LIMIT}s) ====="
  "$REPO/scripts/run_with_time_limit.sh" "$LIMIT" -- npm run --silent rate-tasks 2>&1 | tee "$PASS_OUT"
  CODE=${PIPESTATUS[0]}
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /ai-rating (exit $CODE) ====="
  if [ "$CODE" -eq 124 ]; then
    echo "[ai-rating] the pass hit the ${LIMIT}s time limit and was stopped; tasks it had not saved are rated on the next pass."
  fi
  if grep -qiE "could not sign in to Claude|not signed in|OAuth session expired|Failed to authenticate|Please run /login" "$PASS_OUT"; then
    echo "[ai-rating] $(date "+%H:%M:%S") THIS PASS COULD NOT SIGN IN TO CLAUDE. Nothing will be rated until a person signs in on this machine (claude login); the next pass then runs on its own."
  fi
} 2>&1 | if [ "$ONCE" = 1 ]; then tee -a "$LOG"; else cat >> "$LOG"; fi
