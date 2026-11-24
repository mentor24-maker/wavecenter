import test from "node:test";
import assert from "node:assert/strict";
import { TOPIC_PODS } from "./topicPods.ts";

test("a topic page has Dane's six pods, in his order", () => {
  assert.deepEqual(
    TOPIC_PODS.map((p) => p.title),
    ["Discussion", "Featured content", "Development", "Participation", "Reporting", "Proposals"],
  );
});

test("every pod says what it is for and why it is empty, in a sentence", () => {
  for (const pod of TOPIC_PODS) {
    assert.match(pod.purpose, /^[A-Z].*\.$/, `${pod.title}: purpose`);
    assert.match(pod.emptyBecause, /^[A-Z].*\.$/, `${pod.title}: empty reason`);
  }
});

test("pod keys are unique, so each pod's id on the page is too", () => {
  assert.equal(new Set(TOPIC_PODS.map((p) => p.key)).size, TOPIC_PODS.length);
});
