import test from "node:test";
import assert from "node:assert/strict";
import { saveFailureText } from "./meetingView.ts";

test("a meeting that saved without its invitations is never called not saved", () => {
  const text = saveFailureText({ ok: false, meetingId: "m1", invitesFailed: true, error: "the database did not take them." });
  assert.equal(text, "The meeting saved, but the invitations did not: the database did not take them. Save again to retry the invitations.");
  assert.doesNotMatch(text, /Not saved|Nothing was saved/);
});

test("a save the database refused says Not saved, with the reason", () => {
  assert.equal(
    saveFailureText({ ok: false, error: "Only members of Walkers can plan its meetings." }),
    "Not saved. Only members of Walkers can plan its meetings.",
  );
});

test("an invitations flag without a saved meeting id is treated as not saved", () => {
  assert.match(saveFailureText({ ok: false, invitesFailed: true, error: "x" }), /^Not saved\. /);
});
