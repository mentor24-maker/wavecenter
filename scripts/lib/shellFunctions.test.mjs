// The lane scripts call their own shell functions, and `bash -n` does not
// notice a call to a function that was never defined: the script only fails
// with "command not found" when that line runs, on the Mini. PR #149's
// installer shipped that way (install_interval_lane and uninstall named
// wrongly), so this test reads every scripts/*.sh and checks that each
// function it calls is defined, exactly once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const shellFiles = readdirSync(SCRIPTS).filter((f) => f.endsWith(".sh"));

// Words a case branch may run that are shell builtins, not our functions.
const BUILTINS = new Set(["exit", "echo", "true", "false", "return", ":"]);

function definedFunctions(text) {
  const names = [];
  for (const m of text.matchAll(/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/gm)) names.push(m[1]);
  return names;
}

// Calls worth checking: the first word of a case branch (`--status) status ;;`)
// and any line that starts with a snake_case word (our helpers have an
// underscore; ordinary commands almost never do).
function calledFunctions(text) {
  const called = new Set();
  for (const m of text.matchAll(/\)\s+([a-z_][a-z0-9_]*)\b[^;\n]*;;/g)) {
    if (!BUILTINS.has(m[1])) called.add(m[1]);
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\s|$)/);
    if (m && !/^\s*[a-z_0-9]+\s*\(\)/.test(line) && !/=/.test(line.split(/\s/).filter(Boolean)[0])) called.add(m[1]);
  }
  return called;
}

test("there are shell scripts to check", () => {
  assert.ok(shellFiles.includes("install_loop_runner.sh"));
});

for (const file of shellFiles) {
  const text = readFileSync(join(SCRIPTS, file), "utf8");
  const defined = definedFunctions(text);

  test(`${file}: no function is defined twice`, () => {
    const twice = defined.filter((n, i) => defined.indexOf(n) !== i);
    assert.deepEqual(twice, [], `${file} defines ${twice.join(", ")} more than once; the later one silently wins`);
  });

  test(`${file}: every function it calls is defined`, () => {
    const missing = [...calledFunctions(text)].filter((n) => !defined.includes(n));
    assert.deepEqual(missing, [], `${file} calls ${missing.join(", ")}, which it never defines`);
  });
}

test("the installer defines install, uninstall, status and install_interval_lane", () => {
  const defined = definedFunctions(readFileSync(join(SCRIPTS, "install_loop_runner.sh"), "utf8"));
  for (const name of ["install", "uninstall", "status", "install_interval_lane"]) {
    assert.ok(defined.includes(name), `install_loop_runner.sh does not define ${name}`);
  }
});

test("the checker catches the PR #149 mistake", () => {
  const broken = "uninstall_interval_lane() {\n  :\n}\ninstall() {\n  install_interval_lane a b\n}\ncase x in\n  --uninstall) uninstall ;;\nesac\n";
  const defined = definedFunctions(broken);
  const missing = [...calledFunctions(broken)].filter((n) => !defined.includes(n)).sort();
  assert.deepEqual(missing, ["install_interval_lane", "uninstall"]);
});
