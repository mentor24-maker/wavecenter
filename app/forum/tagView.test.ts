import test from "node:test";
import assert from "node:assert/strict";
import { filterTags, nextTagSort, relatedNames, sortTags, type ViewTag } from "./tagView.ts";

const tag = (id: string, name: string, related: string[], by: string, createdAt: string, more: Partial<ViewTag> = {}): ViewTag => ({
  id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: "",
  related: related.map((r) => ({ id: r.toLowerCase(), name: r })), by, createdAt, mayChange: true, ...more,
});

// In the order the page reads them: A to Z.
const TAGS = [
  tag("b", "Budget", ["Voting"], "you", "2026-11-10T10:00:00Z", { description: "Where the money goes" }),
  tag("star", "Q* and 100%", [], "a former member", "2026-11-13T10:00:00Z"),
  tag("r", "Roads", ["Voting"], "Sasha", "2026-11-12T10:00:00Z"),
  tag("v", "Voting", ["Budget", "Roads"], "Sasha", "2026-11-11T10:00:00Z"),
];
const ids = (list: ViewTag[]) => list.map((t) => t.id);

test("a heading sorts on its first click and reverses on its second", () => {
  const byName = nextTagSort(null, "name");
  assert.deepEqual(ids(sortTags(TAGS, byName)), ["b", "star", "r", "v"]);
  assert.deepEqual(ids(sortTags(TAGS, nextTagSort(byName, "name"))), ["v", "r", "star", "b"]);
  // The date sorts newest first on its first click.
  assert.deepEqual(ids(sortTags(TAGS, nextTagSort(byName, "added"))), ["star", "r", "v", "b"]);
  // Related Tags: tags with none first, then by the list's words; ties keep their order.
  assert.deepEqual(ids(sortTags(TAGS, nextTagSort(null, "related"))), ["star", "v", "b", "r"]);
  assert.deepEqual(ids(sortTags(TAGS, nextTagSort(null, "by"))), ["star", "r", "v", "b"]);
  assert.equal(sortTags(TAGS, null), TAGS);
});

test("the Related Tags column lists the related tags' names, blank when none", () => {
  assert.equal(relatedNames(TAGS[3]), "Budget, Roads");
  assert.equal(relatedNames(TAGS[1]), "");
});

test("the filter matches the name, slug or description, ignoring capitals, as you type", () => {
  assert.deepEqual(ids(filterTags(TAGS, " VOT ")), ["v"]);
  assert.deepEqual(ids(filterTags(TAGS, "q-and")), ["star"]);
  assert.deepEqual(ids(filterTags(TAGS, "money")), ["b"]);
  assert.deepEqual(ids(filterTags(TAGS, "zzz")), []);
  assert.equal(filterTags(TAGS, "  "), TAGS);
});

test('"*", "%" and "_" are matched as typed, never as wildcards', () => {
  assert.deepEqual(ids(filterTags(TAGS, "Q*")), ["star"]);
  assert.deepEqual(ids(filterTags(TAGS, "%")), ["star"]);
  assert.deepEqual(ids(filterTags(TAGS, "*")), ["star"]);
  assert.deepEqual(ids(filterTags(TAGS, "_")), []);
});
