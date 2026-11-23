# The lanes' long-lived Claude sign-in, sourced by scripts/loop_runner.sh.
#
# Copied from Spirality's scripts/loop_runner.sh (SP-385) for WC-181. A
# browser sign-in kept in the keychain ends on a fixed date and every lane
# stops with it, so each pass signs in with the token `claude setup-token`
# makes for unattended jobs (about a year), stored as CLAUDE_CODE_OAUTH_TOKEN
# in Doppler by Spirality's scripts/claude_token_to_doppler.sh. WaveCenter
# reads it from its own manifest's Doppler project and config
# (spirality.project.json: wavecenter/dev), where it is a Doppler reference to
# Spirality's, so there is one token to rotate.
#
# The value lives in a shell variable that is never exported, printed or put
# on a command line (ps shows command lines, not environments); only the
# claude process, and what it starts, gets it. A token that cannot be read
# leaves the pass on this machine's own sign-in, as before, said in one line.
#
# Needs REPO and SLUG set by the caller. DOPPLER_BIN may be set to a stand-in
# (the tests do); otherwise it is the doppler on the PATH.

CLAUDE_TOKEN_KEY=CLAUDE_CODE_OAUTH_TOKEN
DOPPLER_BIN="${DOPPLER_BIN:-$(command -v doppler || true)}"
TOKEN_PROJECT="$(cd "$REPO" && node "$REPO/scripts/project_config.mjs" dopplerProject 2>/dev/null)"
TOKEN_CONFIG="$(cd "$REPO" && node "$REPO/scripts/project_config.mjs" dopplerConfig 2>/dev/null)"

# Sets CLAUDE_TOKEN (empty when there is none to use) and TOKEN_LINE, the one
# log line saying where this pass's sign-in comes from. Run in this shell,
# never in $( ), so CLAUDE_TOKEN sticks without passing through stdout.
read_claude_token() {
  CLAUDE_TOKEN=""
  local where="$TOKEN_PROJECT/$TOKEN_CONFIG" got code err
  local fallback="this pass uses this machine's own Claude sign-in"
  if [ -z "$TOKEN_PROJECT" ] || [ -z "$TOKEN_CONFIG" ]; then
    TOKEN_LINE="the project config in $REPO names no Doppler project and config to read $CLAUDE_TOKEN_KEY from; $fallback"
    return 0
  fi
  if [ -z "$DOPPLER_BIN" ] || [ ! -x "$DOPPLER_BIN" ]; then
    TOKEN_LINE="no doppler on this machine to read $CLAUDE_TOKEN_KEY with; $fallback"
    return 0
  fi
  err="$(mktemp "${TMPDIR:-/tmp}/$SLUG-token-err.XXXXXX")"
  got="$("$DOPPLER_BIN" secrets get "$CLAUDE_TOKEN_KEY" --plain --project "$TOKEN_PROJECT" --config "$TOKEN_CONFIG" 2>"$err")"
  code=$?
  if [ "$code" -ne 0 ]; then
    if grep -qi "could not find requested secret" "$err" 2>/dev/null; then
      TOKEN_LINE="no $CLAUDE_TOKEN_KEY in Doppler $where; $fallback"
    else
      TOKEN_LINE="Doppler $where could not be read for $CLAUDE_TOKEN_KEY (doppler exited $code); $fallback"
    fi
  elif [ -z "$got" ]; then
    TOKEN_LINE="$CLAUDE_TOKEN_KEY in Doppler $where is empty; $fallback"
  elif [[ "$got" == '${'* ]]; then
    # A Doppler reference that did not resolve (wavecenter/dev refers to
    # Spirality's token, WC-181): signing in with its text would fail every pass.
    TOKEN_LINE="$CLAUDE_TOKEN_KEY in Doppler $where is a reference that did not resolve (is the token stored in Spirality's Doppler?), so it is not used; $fallback"
  elif [[ "$got" =~ [[:space:]] ]]; then
    # A token is one word. Anything else is a paste gone wrong; never logged.
    TOKEN_LINE="$CLAUDE_TOKEN_KEY in Doppler $where is not a single word (a paste gone wrong?), so it is not used; $fallback"
  else
    CLAUDE_TOKEN="$got"
    TOKEN_LINE="this pass signs in to Claude with $CLAUDE_TOKEN_KEY from Doppler $where"
  fi
  rm -f "$err"
  got=""
}
