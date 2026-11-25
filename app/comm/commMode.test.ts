import test from "node:test";
import assert from "node:assert/strict";
import { COMM_MODES, commHref, commMode } from "./commMode.ts";

test("commMode: async only when asked, Sync otherwise", () => {
  assert.equal(commMode("async"), "async");
  assert.equal(commMode(["async", "sync"]), "async");
  assert.equal(commMode("sync"), "sync");
  assert.equal(commMode(undefined), "sync");
  assert.equal(commMode("ASYNC"), "sync");
  assert.equal(commMode(""), "sync");
});

test("commHref: the address keeps the mode", () => {
  assert.equal(commHref("sync"), "/comm");
  assert.equal(commHref("async"), "/comm?mode=async");
  assert.equal(commHref("sync", "abc"), "/comm/abc");
  assert.equal(commHref("async", "abc"), "/comm?mode=async");
  for (const m of COMM_MODES) assert.equal(commMode(new URL(commHref(m.mode), "http://x").searchParams.get("mode") ?? undefined), m.mode);
});
