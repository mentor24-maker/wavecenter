// read_claude_token (scripts/lib/claude_token.sh, WC-181, copied from
// Spirality's SP-385): every lane pass signs in to Claude with the long-lived
// CLAUDE_CODE_OAUTH_TOKEN from Doppler when one is stored, and on the
// machine's own sign-in otherwise. Each case runs the real function in bash
// with a stand-in doppler, and checks the one log line it gives and that the
// token's value never reaches that line, stdout or stderr.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(REPO, "spirality.project.json"), "utf8"));
const WHERE = `${manifest.dopplerProject}/${manifest.dopplerConfig}`;
const TOKEN = "sk-ant-oat01-NOT-A-REAL-TOKEN-wc181";
const FALLBACK = "this pass uses this machine's own Claude sign-in";

/** Runs read_claude_token with `doppler` (a bash body, or null for none). */
function readToken(doppler) {
  const scratch = mkdtempSync(join(tmpdir(), "wc-token-"));
  try {
    const fake = join(scratch, "fake-doppler");
    if (doppler) writeFileSync(fake, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${scratch}/doppler-args"\n${doppler}\n`, { mode: 0o755 });
    const script = [
      `REPO=${JSON.stringify(REPO)}`,
      "SLUG=wc-test",
      `source "$REPO/scripts/lib/claude_token.sh"`,
      "read_claude_token",
      `printf '%s' "$TOKEN_LINE" > "${scratch}/line"`,
      `printf '%s' "$CLAUDE_TOKEN" > "${scratch}/token"`,
      // Never exported: a child process must not see it.
      `bash -c 'printf "%s" "\${CLAUDE_TOKEN-unset}"' > "${scratch}/child-saw"`,
    ].join("\n");
    const r = spawnSync("bash", ["-c", script], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, DOPPLER_BIN: fake },
      encoding: "utf8",
    });
    const file = (n) => { try { return readFileSync(join(scratch, n), "utf8"); } catch { return ""; } };
    return { code: r.status, out: r.stdout + r.stderr, line: file("line"), token: file("token"), childSaw: file("child-saw"), args: file("doppler-args").trim() };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function assertNoLeak(r) {
  assert.ok(!r.line.includes(TOKEN), `the log line carries the token: ${r.line}`);
  assert.ok(!r.out.includes(TOKEN), `the token reached stdout/stderr: ${r.out}`);
  assert.equal(r.childSaw, "unset", "CLAUDE_TOKEN was exported to a child process");
}

test("token found: the pass signs in with it, read from this project's Doppler, and the line never shows it", () => {
  const r = readToken(`[ "$1 $2 $3" = "secrets get CLAUDE_CODE_OAUTH_TOKEN" ] && printf '%s\\n' '${TOKEN}'`);
  assert.equal(r.code, 0);
  assert.equal(r.token, TOKEN);
  assert.equal(r.line, `this pass signs in to Claude with CLAUDE_CODE_OAUTH_TOKEN from Doppler ${WHERE}`);
  assert.equal(r.args, `secrets get CLAUDE_CODE_OAUTH_TOKEN --plain --project ${manifest.dopplerProject} --config ${manifest.dopplerConfig}`);
  assertNoLeak(r);
});

test("the manifest names wavecenter/dev, where the token is a reference to Spirality's", () => {
  assert.equal(WHERE, "wavecenter/dev");
});

for (const [name, doppler, line] of [
  ["secret missing", 'echo "Doppler Error: Could not find requested secret: CLAUDE_CODE_OAUTH_TOKEN" >&2; exit 1', `no CLAUDE_CODE_OAUTH_TOKEN in Doppler ${WHERE}; ${FALLBACK}`],
  ["doppler failing", 'echo "Doppler Error: unable to reach the API" >&2; exit 1', `Doppler ${WHERE} could not be read for CLAUDE_CODE_OAUTH_TOKEN (doppler exited 1); ${FALLBACK}`],
  ["empty", 'echo ""', `CLAUDE_CODE_OAUTH_TOKEN in Doppler ${WHERE} is empty; ${FALLBACK}`],
  ["not one word", `printf '%s\\n' '${TOKEN} ${TOKEN}'`, `CLAUDE_CODE_OAUTH_TOKEN in Doppler ${WHERE} is not a single word (a paste gone wrong?), so it is not used; ${FALLBACK}`],
  ["an unresolved reference", "printf '%s\\n' '${spirality.dev.CLAUDE_CODE_OAUTH_TOKEN}'", `CLAUDE_CODE_OAUTH_TOKEN in Doppler ${WHERE} is a reference that did not resolve (is the token stored in Spirality's Doppler?), so it is not used; ${FALLBACK}`],
  ["no doppler at all", null, `no doppler on this machine to read CLAUDE_CODE_OAUTH_TOKEN with; ${FALLBACK}`],
]) {
  test(`${name}: no token is used, the pass runs on the machine's own sign-in, said in one line`, () => {
    const r = readToken(doppler);
    assert.equal(r.code, 0);
    assert.equal(r.token, "");
    assert.equal(r.line, line);
    assertNoLeak(r);
  });
}

// Both runners: loop_runner.sh (build, review, intake) and
// project_lane_runner.sh (hand-off, scripts/install_loop_runner.sh runner_of).
for (const file of ["loop_runner.sh", "project_lane_runner.sh"]) {
  const runner = readFileSync(join(REPO, "scripts", file), "utf8");

  test(`${file}: logs the sign-in line after START and exports the token only to the pass's own subshell`, () => {
    assert.match(runner, /source "\$REPO\/scripts\/lib\/claude_token\.sh"/);
    assert.match(runner, /\n\s+read_claude_token\n/);
    assert.match(runner, /START \/\$SKILL[^\n]*=====" >> "\$LOG"\n\s+echo "\[loop-runner\] \$\(date "\+%H:%M:%S"\) \$TOKEN_LINE" >> "\$LOG"\n/);
    // The only export of the token is inside the ( ... ) that starts claude -p.
    const exports = runner.split("\n").filter((l) => /export\s+CLAUDE_CODE_OAUTH_TOKEN/.test(l));
    assert.equal(exports.length, 1);
    assert.match(runner, /\(\n\s+if \[ -n "\$CLAUDE_TOKEN" \]; then export CLAUDE_CODE_OAUTH_TOKEN="\$CLAUDE_TOKEN"; fi\n[\s\S]*?"\$CLAUDE_BIN" -p[\s\S]*?\n\s+\) 2>&1 \| tee/);
    // The value is never echoed or put on a command line.
    assert.ok(!/echo[^\n]*\$CLAUDE_TOKEN\b/.test(runner), `${file} echoes $CLAUDE_TOKEN`);
    assert.ok(!/echo[^\n]*\$CLAUDE_CODE_OAUTH_TOKEN/.test(runner), `${file} echoes $CLAUDE_CODE_OAUTH_TOKEN`);
  });

  test(`${file}: the sign-in failure line names both fixes, worded by which sign-in failed`, () => {
    const lines = runner.split("\n").filter((l) => l.includes("THIS PASS COULD NOT SIGN IN TO CLAUDE"));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /with \$CLAUDE_TOKEN_KEY from Doppler \$TOKEN_PROJECT\/\$TOKEN_CONFIG\./);
    for (const l of lines) {
      assert.match(l, /claude setup-token/);
      assert.match(l, /bash ~\/WebApps\/spirality\/scripts\/claude_token_to_doppler\.sh/);
    }
    assert.match(lines[1], /claude login/);
  });
}
