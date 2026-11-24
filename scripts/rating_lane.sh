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
# It signs in with the long-lived CLAUDE_CODE_OAUTH_TOKEN (WC-184), read from
# Doppler the same way the loop lanes do (scripts/lib/claude_token.sh,
# WC-181): `claude setup-token` makes it, it is billed to the same claude.ai
# plan, and it outlives the browser sign-in. It is never printed, never on a
# command line, and exported only to the rating pass. With none stored, the
# pass uses this machine's own sign-in, as before, said in one log line.
#
# launchd will not start a second copy of a job while one runs, so there is
# no lock. The build and review lanes pull main; this one runs what they pulled.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
# Only the token read from Doppler below signs in; none inherited from a shell.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN

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

SLUG=wavecenter-rating
# shellcheck source=lib/claude_token.sh
source "$REPO/scripts/lib/claude_token.sh"
read_claude_token
USED_TOKEN=""
[ -n "$CLAUDE_TOKEN" ] && USED_TOKEN=yes

# A working pass of 10 tasks, two models each, two calls at a time, takes
# about 5 to 10 minutes. One still running at 15 minutes is stopped; anything
# it had not saved is rated on the next pass.
LIMIT="${RATING_PASS_LIMIT_SECONDS:-900}"

{
  echo ""
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /ai-rating (time limit ${LIMIT}s) ====="
  echo "[ai-rating] $(date "+%H:%M:%S") $TOKEN_LINE"
  # The token is exported inside this subshell only, so the rating pass gets
  # it in its environment and nothing else this script starts ever does.
  (
    if [ -n "$CLAUDE_TOKEN" ]; then export CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_TOKEN"; fi
    CLAUDE_TOKEN=""
    "$REPO/scripts/run_with_time_limit.sh" "$LIMIT" -- npm run --silent rate-tasks
  ) 2>&1 | tee "$PASS_OUT"
  CODE=${PIPESTATUS[0]}
  CLAUDE_TOKEN=""
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /ai-rating (exit $CODE) ====="
  if [ "$CODE" -eq 124 ]; then
    echo "[ai-rating] the pass hit the ${LIMIT}s time limit and was stopped; tasks it had not saved are rated on the next pass."
  fi
  if grep -qiE "could not sign in to Claude|not signed in|OAuth session expired|Failed to authenticate|Please run /login" "$PASS_OUT"; then
    if [ -n "$USED_TOKEN" ]; then
      echo "[ai-rating] $(date "+%H:%M:%S") THIS PASS COULD NOT SIGN IN TO CLAUDE with $CLAUDE_TOKEN_KEY from Doppler $TOKEN_PROJECT/$TOKEN_CONFIG. Nothing will be rated until the account holder makes a new token on this machine (claude setup-token) and stores it (bash ~/WebApps/spirality/scripts/claude_token_to_doppler.sh); the next pass then reads it on its own."
    else
      echo "[ai-rating] $(date "+%H:%M:%S") THIS PASS COULD NOT SIGN IN TO CLAUDE. Nothing will be rated until a person signs in on this machine. Best: make a long-lived token for unattended jobs (claude setup-token) and store it (bash ~/WebApps/spirality/scripts/claude_token_to_doppler.sh), which the next pass reads; or sign in again (claude login). The next pass then runs on its own."
    fi
  fi
} 2>&1 | if [ "$ONCE" = 1 ]; then tee -a "$LOG"; else cat >> "$LOG"; fi
