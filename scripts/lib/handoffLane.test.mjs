// WaveCenter's hand-off lane (WC-163): installed beside Spirality's lanes,
// every 10 minutes, each pass stopped after 900 s, and signed in to the
// tracker as its own seat because spirality.project.json names it in
// "projectLanes" (SP-180). The installer's own functions are run in bash
// here, so what launchd is handed is what is checked, not a reading of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "../../loop/lib/projectConfig.mjs";
import { projectSeats } from "../../loop/scripts/lib/expectedSecrets.mjs";
import { trackerTokenEnv } from "../../loop/scripts/tracker/apiTracker.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLER = readFileSync(join(REPO, "scripts", "install_loop_runner.sh"), "utf8");

/** One shell function's definition, from `name() {` to its closing `}` line. */
function shellFunction(name) {
  const m = INSTALLER.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, "m"));
  assert.ok(m, `install_loop_runner.sh defines no ${name}()`);
  return m[0];
}

/** Run a line of bash with the installer's helpers defined. */
function bash(line) {
  const defs = ["interval_of", "limit_of", "limit_env", "plist_env"].map(shellFunction).join("\n");
  const r = spawnSync("bash", ["-c", `set -euo pipefail\nLAUNCHD_PATH=/usr/bin\nHOME=/home/x\n${defs}\n${line}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("the installer runs loop-handoff as one of its kept-alive lanes", () => {
  const skills = INSTALLER.match(/^SKILLS=\(([^)]*)\)$/m);
  assert.ok(skills, "no SKILLS=(...) line");
  assert.deepEqual(skills[1].split(/\s+/), ["loop-build", "loop-review", "loop-intake", "loop-handoff"]);
});

test("a hand-off pass wakes every 10 minutes and is stopped after 900 s, as before the move", () => {
  assert.equal(bash('interval_of loop-handoff').trim(), "600");
  const env = bash('plist_env $(limit_env loop-handoff)');
  assert.match(env, /<key>LOOP_PASS_LIMIT_SECONDS<\/key>\n\s*<string>900<\/string>/);
  assert.match(env, /<key>PATH<\/key>\n\s*<string>\/usr\/bin<\/string>/);
});

test("Spirality's lanes keep the runner's own default limit (no LOOP_PASS_LIMIT_SECONDS)", () => {
  for (const lane of ["loop-build", "loop-review", "loop-intake"]) {
    const env = bash(`plist_env $(limit_env ${lane})`);
    assert.doesNotMatch(env, /LOOP_PASS_LIMIT_SECONDS/, lane);
    assert.match(env, /<key>HOME<\/key>/, lane);
  }
});

test("the project config names loop-handoff, so its runner's secret name is a seat the door accepts", () => {
  const project = loadProjectConfig({ cwd: REPO, env: {} });
  assert.deepEqual(project.projectLanes, ["loop-handoff"]);
  const seats = projectSeats(project);
  // loop_runner.sh exports TRACKER_TOKEN_NAME from the skill's name the same way.
  assert.equal(trackerTokenEnv({ TRACKER_TOKEN_NAME: "TRACKER_TOKEN_LOOP_HANDOFF" }, seats), "TRACKER_TOKEN_LOOP_HANDOFF");
  // Without the project's seats (what scripts/wavecenter_tasks.mjs passed before WC-163), it is refused.
  assert.throws(() => trackerTokenEnv({ TRACKER_TOKEN_NAME: "TRACKER_TOKEN_LOOP_HANDOFF" }), /projectLanes/);
  // The operator's own seat is still never one a lane can name.
  assert.throws(() => trackerTokenEnv({ TRACKER_TOKEN_NAME: "TRACKER_TOKEN_OPERATOR" }, seats), /must name a loop's own tracker secret/);
});

test("WaveCenter's own door signs in with the project's seats and never exits on a refused sign-in", () => {
  const door = readFileSync(join(REPO, "scripts", "wavecenter_tasks.mjs"), "utf8");
  const body = door.match(/^function theTracker\(\) \{\n[\s\S]*?^\}$/m);
  assert.ok(body, "scripts/wavecenter_tasks.mjs defines no theTracker()");
  assert.match(body[0], /trackerTokenEnv\(process\.env, projectSeats\(project\)\)/);
  // A process.exit here would end handoff-sync at the first task it reads.
  assert.doesNotMatch(body[0], /process\.exit/);
});
