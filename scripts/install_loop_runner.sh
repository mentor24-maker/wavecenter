#!/bin/bash
#
# Install (or remove) the WaveCenter loop runners on THIS machine: loop-build
# and loop-review, each a launchd agent that keeps the committed runner alive.
#
#   ./scripts/install_loop_runner.sh              # install both loops here
#   ./scripts/install_loop_runner.sh --status     # installed? running? locks? last pass?
#   ./scripts/install_loop_runner.sh --uninstall  # remove both from here
#
# Copied from StarCaster's installer. launchd starts the runner at load,
# restarts it if it dies, and survives a reboot; a screen session does none of
# that. Labels are com.wavecenter.<skill>, so they sit beside StarCaster's
# com.starcaster.<skill> on the same machine without touching them.
#
# Every path is derived from where this script lives, never typed in.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS=(loop-build loop-review)

interval_of() {
  case "$1" in
    loop-build)  echo 1800 ;;
    loop-review) echo 1800 ;;
    *)           echo 3600 ;;
  esac
}
label_of() { echo "com.wavecenter.$1"; }
plist_of() { echo "$HOME/Library/LaunchAgents/$(label_of "$1").plist"; }

status_one() {
  local skill="$1" label plist lock log
  label="$(label_of "$skill")"; plist="$(plist_of "$skill")"
  lock="$HOME/loop-logs/wavecenter-$skill.lock"; log="$HOME/loop-logs/wavecenter-$skill.log"
  echo "── $skill"
  if [ -f "$plist" ]; then echo "schedule: INSTALLED at $plist"; else echo "schedule: not installed on this machine"; fi
  if launchctl list | grep -q "$label"; then
    echo "loaded:   yes — $(launchctl list | grep "$label")"
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

status() { for s in "${SKILLS[@]}"; do status_one "$s"; done; }

uninstall() {
  for s in "${SKILLS[@]}"; do
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
  for bin in npm doppler claude git; do
    if ! command -v "$bin" >/dev/null && [ ! -x "$HOME/.local/bin/$bin" ]; then
      echo "Cannot find $bin on this machine — the loops would install and then fail on every pass." >&2
      exit 1
    fi
  done
  chmod +x "$REPO/scripts/loop_runner.sh" "$REPO/scripts/run_with_time_limit.sh"

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
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string>
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
  echo
  status
}

case "${1:-}" in
  --uninstall|--remove) uninstall ;;
  --status)             status ;;
  ""|--install)         install ;;
  *) echo "usage: $0 [--install | --uninstall | --status]" >&2; exit 2 ;;
esac
