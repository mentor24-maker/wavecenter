#!/bin/bash
# Run one WaveCenter loop skill on a fixed interval, forever.
#
#   loop_runner.sh <skill-name> [interval-seconds]
#
# A seed-sized copy of StarCaster's scripts/loop_runner.sh: the lock, the
# pull-before-pass, the time limit and the honest END line are kept; the
# queue-paced sleeping, heartbeat and usage-limit guard are left out until
# WaveCenter has an incident that needs them.
#
# Each iteration is a FRESH headless Claude Code session started in the main
# checkout. Both loop skills pick the next ticket from ClickUp on every run,
# so there is no state to carry between runs, and a crashed run costs one
# interval rather than the whole night.
#
# --allowedTools is used instead of --dangerously-skip-permissions so the
# repo's PreToolUse hook (no edits on main) still applies. A headless run
# cannot answer a permission prompt, so anything not listed is refused and
# the run continues.
set -u

# launchd hands the job almost no environment. Set the PATH once, here.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

SKILL=${1:?usage: loop_runner.sh <skill-name> [interval-seconds]}
INTERVAL=${2:-1800}

# The repo is WHERE THIS SCRIPT LIVES, never a path typed from memory, and it
# must be the MAIN checkout: a worktree is deleted when its work ships.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
  echo "[loop-runner] Refusing to run from a worktree ($REPO) — worktrees are deleted when their work ships." >&2
  exit 1
fi

LOG="$HOME/loop-logs/wavecenter-$SKILL.log"
LOCK="$HOME/loop-logs/wavecenter-$SKILL.lock"
mkdir -p "$HOME/loop-logs"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"

# One runner per skill. A stale lock (its pid gone) is announced and taken over,
# so a reboot never leaves the loop dead behind a lock nobody holds.
if ! mkdir "$LOCK" 2>/dev/null; then
  OLD_PID="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[loop-runner] $SKILL is already running (pid $OLD_PID, lock: $LOCK). Refusing to start a second."
    exit 1
  fi
  echo "[loop-runner] found a STALE lock (pid ${OLD_PID:-unrecorded}, no such process) — clearing it and taking over." | tee -a "$LOG"
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || { echo "[loop-runner] the lock could not be retaken. Stopping."; exit 1; }
fi
echo "$$" > "$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

cd "$REPO" || exit 1

while true; do
  # 1. A timid pull: only main, only a clean tree, only fast-forward. A refusal
  #    is logged but never blocks the pass.
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] && [ -z "$(git status --porcelain)" ]; then
    git pull -q --ff-only origin main >> "$LOG" 2>&1 || echo "[loop-runner] $(date "+%H:%M:%S") pull of main refused (see above) — running on the checkout as it is" >> "$LOG"
    # Dependencies follow the lockfile, so a merged change to package.json takes effect on the next pass.
    npm ci --silent >> "$LOG" 2>&1 || echo "[loop-runner] $(date "+%H:%M:%S") npm ci failed — running with the node_modules already present" >> "$LOG"
  else
    echo "[loop-runner] $(date "+%H:%M:%S") main checkout is not on a clean main — not pulling" >> "$LOG"
  fi

  echo "" >> "$LOG"
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") START /$SKILL =====" >> "$LOG"
  "$REPO/scripts/run_with_time_limit.sh" "${LOOP_PASS_LIMIT_SECONDS:-7200}" -- \
    "$CLAUDE_BIN" -p "/$SKILL" \
    --allowedTools Bash Edit Write Read Glob Grep Task TodoWrite WebFetch \
    >> "$LOG" 2>&1
  CODE=$?
  # `claude -p` exits 0 whenever it produced output, so the code is a fact
  # about the process, not a verdict on the pass. The pass's own report is.
  echo "===== $(date "+%Y-%m-%d %H:%M:%S") END /$SKILL (exit $CODE — not a verdict; the pass's report above is) =====" >> "$LOG"
  if [ "$CODE" -eq 124 ]; then
    echo "[loop-runner] the pass hit the ${LOOP_PASS_LIMIT_SECONDS:-7200}s time limit and was stopped; its ticket may still be in Building — the next pass or a person should hand it back." >> "$LOG"
  fi
  if grep -qiE "OAuth session expired|Failed to authenticate|not logged in" <(tail -40 "$LOG"); then
    echo "[loop-runner] $(date "+%H:%M:%S") THIS PASS COULD NOT SIGN IN TO CLAUDE. Nothing will change until a person signs in on this machine (claude login) and restarts this job: launchctl kickstart -k gui/$(id -u)/com.wavecenter.$SKILL" >> "$LOG"
  fi

  echo "[loop-runner] $(date "+%H:%M:%S") sleeping ${INTERVAL}s before the next /$SKILL" >> "$LOG"
  sleep "$INTERVAL"
done
