import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_TOPIC_FILTER, filterTopics, isFilteringTopics, nextTopicSort, parentChoices, sortTopics, type ViewTopic,
} from "./topicView.ts";

const topic = (id: string, name: string, parent: [string, string] | null, by: string, createdAt: string, more: Partial<ViewTopic> = {}): ViewTopic => ({
  id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: "", parentId: parent?.[0] ?? null, parentName: parent?.[1] ?? "",
  by, createdAt, mayChange: true, ...more,
});

// In the order the page reads them: A to Z.
const TOPICS = [
  topic("b", "Budget", null, "you", "2026-11-10T10:00:00Z", { description: "Where the money goes" }),
  topic("q", "Quorum", ["v", "Voting rules"], "Sasha", "2026-11-12T10:00:00Z"),
  topic("s", "Quorum size", ["q", "Quorum"], "you", "2026-11-14T10:00:00Z"),
  topic("star", "Q* and 100%", ["v", "Voting rules"], "a former member", "2026-11-13T10:00:00Z"),
  topic("v", "Voting rules", null, "Sasha", "2026-11-11T10:00:00Z"),
];
const ids = (list: ViewTopic[]) => list.map((t) => t.id);

test("a heading sorts on its first click and reverses on its second", () => {
  const byName = nextTopicSort(null, "name");
  assert.deepEqual(byName, { key: "name", ascending: true });
  assert.deepEqual(ids(sortTopics(TOPICS, byName)), ["b", "star", "q", "s", "v"]);
  const reversed = nextTopicSort(byName, "name");
  assert.deepEqual(ids(sortTopics(TOPICS, reversed)), ["v", "s", "q", "star", "b"]);
  // The date sorts newest first on its first click.
  assert.deepEqual(ids(sortTopics(TOPICS, nextTopicSort(reversed, "added"))), ["s", "star", "q", "v", "b"]);
  // Parent: topics with none first, then by the parent's name; ties keep their order.
  assert.deepEqual(ids(sortTopics(TOPICS, nextTopicSort(null, "parent"))), ["b", "v", "s", "q", "star"]);
  assert.deepEqual(ids(sortTopics(TOPICS, nextTopicSort(null, "by"))), ["star", "q", "v", "b", "s"]);
  assert.equal(sortTopics(TOPICS, null), TOPICS);
});

test("the text filter matches the name, slug or description, ignoring capitals", () => {
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: " QUOR " })), ["q", "s"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "voting-rules" })), ["v"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "money" })), ["b"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "zzz" })), []);
});

test('"*", "%" and "_" are matched as typed, never as wildcards', () => {
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "Q*" })), ["star"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "%" })), ["star"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "_" })), []);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, text: "*" })), ["star"]);
});

test("the parent filter narrows to one parent's sub-topics, or to topics with no parent, and works with the text", () => {
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, parent: "v" })), ["q", "star"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { ...NO_TOPIC_FILTER, parent: "none" })), ["b", "v"]);
  assert.deepEqual(ids(filterTopics(TOPICS, { text: "quorum", parent: "v" })), ["q"]);
  assert.equal(isFilteringTopics(NO_TOPIC_FILTER), false);
  assert.equal(isFilteringTopics({ text: "  ", parent: "any" }), false);
  assert.equal(isFilteringTopics({ text: "", parent: "none" }), true);
});

test("the Parent topic dropdown lists every topic that has a sub-topic, A to Z", () => {
  assert.deepEqual(parentChoices(TOPICS), [{ id: "q", name: "Quorum" }, { id: "v", name: "Voting rules" }]);
  assert.deepEqual(parentChoices([TOPICS[0]]), []);
});
