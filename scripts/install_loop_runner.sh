#!/bin/bash
#
# Install (or remove) the WaveCenter loop lanes on THIS machine, as launchd
# agents: loop-build, loop-review and loop-handoff (each keeps the committed
# runner alive; loop-handoff files the tasks members tick for AI agents as
# Loop Queue tickets), and merge-on-comment (a plain node pass every 10 minutes that carries out
# Dane's written "merge"; no Claude session).
#
#   ./scripts/install_loop_runner.sh              # install all four lanes here
#   ./scripts/install_loop_runner.sh --status     # installed? running? locks? last pass?
#   ./scripts/install_loop_runner.sh --uninstall  # remove all four from here
#
# Copied from StarCaster's installer. launchd starts the runner at load,
# restarts it if it dies, and survives a reboot; a screen session does none of
# that. Labels are com.wavecenter.<skill>, so they sit beside StarCaster's
# com.starcaster.<skill> on the same machine without touching them.
#
# Every path is derived from where this script lives, never typed in.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS=(loop-build loop-review loop-handoff)
MERGE_LANE=merge-on-comment
LANES=("${SKILLS[@]}" "$MERGE_LANE")

interval_of() {
  case "$1" in
    loop-build)  echo 900 ;;
    loop-review) echo 900 ;;
    loop-handoff) echo 600 ;;
    merge-on-comment) echo 600 ;;
    *)           echo 3600 ;;
  esac
}
label_of() { echo "com.wavecenter.$1"; }
# The PATH launchd gives the runner. The installer checks the tools against
# THIS, not its own shell's PATH, because launchd is what will run them.
LAUNCHD_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"
plist_of() { echo "$HOME/Library/LaunchAgents/$(label_of "$1").plist"; }

status_one() {
  local skill="$1" label plist lock log
  label="$(label_of "$skill")"; plist="$(plist_of "$skill")"
  lock="$HOME/loop-logs/wavecenter-$skill.lock"; log="$HOME/loop-logs/wavecenter-$skill.log"
  echo "── $skill"
  if [ -f "$plist" ]; then echo "schedule: INSTALLED at $plist — every $(( $(interval_of "$skill") / 60 )) minutes"; else echo "schedule: not installed on this machine"; fi
  # Read launchctl's list into a variable first. Piping it straight into
  # `grep -q` under pipefail reported a live lane as "loaded: no": grep quits
  # at the first match, launchctl dies of SIGPIPE, and the pipeline "fails".
  local listing line
  listing="$(launchctl list 2>/dev/null || true)"
  line="$(awk -v l="$label" '$3 == l' <<<"$listing")"
  if [ -n "$line" ]; then
    echo "loaded:   yes — $line"
    echo "          (columns: PID, last exit code, label. A PID here means the runner is alive right now.)"
  else
    echo "loaded:   no"
  fi
  if [ -d "$lock" ]; then
    local pid; pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "lock:     held by live pid $pid — a runner is working"
    else echo "lock:     STALE (pid ${pid:-unrecorded} is gone) — the next start clears it"; fi
  else
    echo "lock:     none"
  fi
  if [ -f "$log" ]; then
    echo "log:      $log (last modified $(date -r "$log" '+%Y-%m-%d %H:%M'))"
    echo "last pass: $(grep -E "START /$skill" "$log" | tail -1 | sed 's/=//g' | xargs || echo '(none yet)')"
  else
    echo "log:      $log (nothing written yet)"
  fi
}

# The runner only pulls when the checkout is a clean main. On anything else
# every pass runs stale code and says so in one quiet log line, so say it
# loudly here instead.
checkout_state() {
  local branch dirty
  branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  dirty="$(git -C "$REPO" status --porcelain 2>/dev/null)"
  if [ "$branch" = "main" ] && [ -z "$dirty" ]; then
    echo "checkout: $REPO on a clean main — each pass pulls the latest merged work"
  else
    echo "checkout: $REPO on branch '$branch'$([ -n "$dirty" ] && echo ', with uncommitted changes')"
    echo "WARNING:  the runner only pulls a clean main, so every pass runs THIS code and never"
    echo "          picks up merged work. Put it back: git -C $REPO checkout main && git -C $REPO pull"
  fi
}

status() { checkout_state; for s in "${LANES[@]}"; do status_one "$s"; done; }

uninstall() {
  for s in "${LANES[@]}"; do
    launchctl bootout "gui/$(id -u)/$(label_of "$s")" 2>/dev/null || true
    rm -f "$(plist_of "$s")"
    echo "Removed $(label_of "$s") from this machine."
  done
  echo "Locks are left for the runners' own stale-lock handling. Confirm with: $0 --status"
}

install() {
  if [ -f "$REPO/.git" ] && grep -q '^gitdir:.*worktrees' "$REPO/.git" 2>/dev/null; then
    echo "Refusing to install: $REPO is a worktree, and worktrees get deleted when their work ships. Run this from the main checkout." >&2
    exit 1
  fi
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/loop-logs"
  for bin in npm node doppler claude git gh; do
    if ! (PATH="$LAUNCHD_PATH" command -v "$bin" >/dev/null); then
      echo "Cannot find $bin on launchd's PATH ($LAUNCHD_PATH) — the loops would install and then fail on every pass." >&2
      exit 1
    fi
  done
  if [ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" != "main" ]; then
    echo "WARNING: $REPO is not on main. The runner will install, but it never pulls" >&2
    echo "         anything but a clean main, so it will run this branch's code until" >&2
    echo "         the checkout is put back on main." >&2
  fi
  chmod +x "$REPO/scripts/loop_runner.sh" "$REPO/scripts/run_with_time_limit.sh" "$REPO/scripts/merge_lane.sh"
  if ! (PATH="$LAUNCHD_PATH" gh auth status >/dev/null 2>&1); then
    echo "gh is not signed in to GitHub on this machine — the merge lane would read every \"merge\" and fail to act." >&2
    echo "A person signs in once with: gh auth login" >&2
    exit 1
  fi

  for s in "${SKILLS[@]}"; do
    local_label="$(label_of "$s")"; local_plist="$(plist_of "$s")"
    local_llog="$HOME/Library/Logs/$local_label.launchd.log"
    cat > "$local_plist" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$local_label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO/scripts/loop_runner.sh</string>
        <string>$s</string>
        <string>$(interval_of "$s")</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>300</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$LAUNCHD_PATH</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$local_llog</string>
    <key>StandardErrorPath</key>
    <string>$local_llog</string>
</dict>
</plist>
PLIST_BODY
    launchctl bootout "gui/$(id -u)/$local_label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$local_plist"
    echo "Installed $local_label — kept alive from $REPO (every $(interval_of "$s")s)."
  done

  # The merge lane: one short pass every 10 minutes (StartInterval), not a
  # kept-alive loop. launchd never runs two copies of one job at once.
  local_label="$(label_of "$MERGE_LANE")"; local_plist="$(plist_of "$MERGE_LANE")"
  local_llog="$HOME/Library/Logs/$local_label.launchd.log"
  cat > "$local_plist" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$local_label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO/scripts/merge_lane.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>$(interval_of "$MERGE_LANE")</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$LAUNCHD_PATH</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$local_llog</string>
    <key>StandardErrorPath</key>
    <string>$local_llog</string>
</dict>
</plist>
PLIST_BODY
  launchctl bootout "gui/$(id -u)/$local_label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$local_plist"
  echo "Installed $local_label — one pass every $(interval_of "$MERGE_LANE")s from $REPO."
  echo
  status
}

case "${1:-}" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  ""|--install)         install ;;
  *) echo "usage: $0 [--install | --uninstall | --status]" >&2; exit 2 ;;
esac
