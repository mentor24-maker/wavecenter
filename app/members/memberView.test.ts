import test from "node:test";
import assert from "node:assert/strict";
import {
  ANONYMOUS, NO_MEMBER_FILTER, filterMembers, isFiltering, matches, nextSort, shownName, sortMembers, type ViewMember,
} from "./memberView.ts";

const member = (memberId: string, displayName: string | null, role: ViewMember["role"], joinedAt: string): ViewMember => ({
  memberId, displayName, role, joinedAt,
});

// In the order the page reads them: oldest member first.
const MEMBERS = [
  member("dane", "Dane", "admin", "2026-10-01T10:00:00Z"),
  member("lee", "lee", "viewer", "2026-10-05T10:00:00Z"),
  member("anon", null, "contributor", "2026-10-07T10:00:00Z"),
  member("sasha", "Sasha", "editor", "2026-10-09T10:00:00Z"),
  member("robin", "Robin", "contributor", "2026-10-09T10:00:00Z"),
];
const ids = (list: ViewMember[]) => list.map((m) => m.memberId);

test("a member with no name on show is an anonymous member", () => {
  assert.equal(shownName({ displayName: null }), ANONYMOUS);
  assert.equal(shownName({ displayName: "  " }), ANONYMOUS);
  assert.equal(shownName({ displayName: "Dane" }), "Dane");
});

test("the text filter narrows by the name shown, ignoring capitals and spaces around it", () => {
  assert.deepEqual(ids(filterMembers(MEMBERS, { ...NO_MEMBER_FILTER, text: "  DA " })), ["dane"]);
  assert.deepEqual(ids(filterMembers(MEMBERS, { ...NO_MEMBER_FILTER, text: "anonymous" })), ["anon"]);
  assert.deepEqual(ids(filterMembers(MEMBERS, { ...NO_MEMBER_FILTER, text: "zzzz" })), []);
});

test("the role filter narrows by role, and works with the text filter", () => {
  assert.deepEqual(ids(filterMembers(MEMBERS, { ...NO_MEMBER_FILTER, role: "admin" })), ["dane"]);
  assert.deepEqual(ids(filterMembers(MEMBERS, { ...NO_MEMBER_FILTER, role: "contributor" })), ["anon", "robin"]);
  assert.deepEqual(ids(filterMembers(MEMBERS, { text: "rob", role: "contributor" })), ["robin"]);
  assert.equal(matches(MEMBERS[0], { text: "dane", role: "viewer" }), false);
});

test("clearing both filters shows everyone, in the order they came", () => {
  assert.equal(isFiltering(NO_MEMBER_FILTER), false);
  assert.equal(isFiltering({ text: " ", role: "all" }), false);
  assert.equal(isFiltering({ text: "", role: "viewer" }), true);
  assert.deepEqual(ids(filterMembers(MEMBERS, NO_MEMBER_FILTER)), ids(MEMBERS));
});

test("a heading sorts on the first click and reverses on the second; another heading starts fresh", () => {
  assert.deepEqual(nextSort(null, "name"), { key: "name", ascending: true });
  assert.deepEqual(nextSort(null, "joined"), { key: "joined", ascending: false });
  assert.deepEqual(nextSort(null, "role"), { key: "role", ascending: true });
  assert.deepEqual(nextSort({ key: "joined", ascending: false }, "joined"), { key: "joined", ascending: true });
  assert.deepEqual(nextSort({ key: "joined", ascending: true }, "name"), { key: "name", ascending: true });
});

test("Member sorts A–Z by the name shown, ignoring capitals", () => {
  assert.deepEqual(ids(sortMembers(MEMBERS, { key: "name", ascending: true })), ["anon", "dane", "lee", "robin", "sasha"]);
  assert.deepEqual(ids(sortMembers(MEMBERS, { key: "name", ascending: false })), ["sasha", "robin", "lee", "dane", "anon"]);
});

test("Joined sorts newest first on the first click; members who joined together keep their order", () => {
  assert.deepEqual(ids(sortMembers(MEMBERS, nextSort(null, "joined"))), ["sasha", "robin", "anon", "lee", "dane"]);
  assert.deepEqual(ids(sortMembers(MEMBERS, { key: "joined", ascending: true })), ["dane", "lee", "anon", "sasha", "robin"]);
});

test("Role sorts in the order of the roles: Admin, Editor, Contributor, Reviewer, Viewer", () => {
  assert.deepEqual(ids(sortMembers(MEMBERS, { key: "role", ascending: true })), ["dane", "sasha", "anon", "robin", "lee"]);
  assert.deepEqual(ids(sortMembers(MEMBERS, { key: "role", ascending: false })), ["lee", "anon", "robin", "sasha", "dane"]);
});

test("no sort leaves the list as it came, and sorting never changes the list it was given", () => {
  assert.equal(sortMembers(MEMBERS, null), MEMBERS);
  const before = ids(MEMBERS);
  sortMembers(MEMBERS, { key: "name", ascending: true });
  assert.deepEqual(ids(MEMBERS), before);
});
