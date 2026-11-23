import test from "node:test";
import assert from "node:assert/strict";
import { SUBJECT_MAX } from "../../core/messages.ts";
import {
  DEFAULT_MESSAGE_SORT, NO_MESSAGE_FILTER, directionLabel, filterMessages, isFiltering, matches, nextSort, replySubject, sortMessages,
  trashCount, type ViewMessage,
} from "./messageView.ts";

const message = (id: string, direction: ViewMessage["direction"], other: string, subject: string, sentAt: string, more: Partial<ViewMessage> = {}): ViewMessage => ({
  id, direction, other, subject, body: `Text of ${subject}`, sentAt, starred: false, trashed: false, ...more,
});

// In the order the page reads them: newest first.
const MESSAGES = [
  message("m5", "from", "Kim", "lunch plans", "2026-11-05T10:00:00Z", { starred: true }),
  message("m4", "to", "robin", "Budget", "2026-11-04T10:00:00Z"),
  message("m3", "self", "Dane", "Note", "2026-11-03T10:00:00Z", { body: "remember the budget" }),
  message("m2", "from", "Anonymous member", "Hello", "2026-11-02T10:00:00Z", { trashed: true }),
  message("m1", "to", "Kim", "Agenda", "2026-11-01T10:00:00Z", { starred: true, trashed: true }),
];
const ids = (list: ViewMessage[]) => list.map((m) => m.id);
const shown = (f = NO_MESSAGE_FILTER) => ids(filterMessages(MESSAGES, f));

test("with no filter, every message not in the trash shows", () => {
  assert.deepEqual(shown(), ["m5", "m4", "m3"]);
  assert.equal(isFiltering(NO_MESSAGE_FILTER), false);
  assert.equal(trashCount(MESSAGES), 2);
});

test("Show trash adds the trashed messages back, and is not a narrowing filter", () => {
  const f = { ...NO_MESSAGE_FILTER, showTrash: true };
  assert.deepEqual(shown(f), ["m5", "m4", "m3", "m2", "m1"]);
  assert.equal(isFiltering(f), false);
});

test("the text filter matches the member, the subject and the text, ignoring capitals and spaces around it", () => {
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, text: " kim " }), ["m5"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, text: "BUDGET" }), ["m4", "m3"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, text: "text of lunch" }), ["m5"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, text: "zzzz" }), []);
  assert.equal(isFiltering({ ...NO_MESSAGE_FILTER, text: "zzzz" }), true);
});

test("Received and Sent narrow by direction; a note to yourself is both", () => {
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, direction: "received" }), ["m5", "m3"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, direction: "sent" }), ["m4", "m3"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, direction: "sent", showTrash: true }), ["m4", "m3", "m1"]);
});

test("Starred only keeps the starred ones, and works with the other filters", () => {
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, starredOnly: true }), ["m5"]);
  assert.deepEqual(shown({ ...NO_MESSAGE_FILTER, starredOnly: true, showTrash: true }), ["m5", "m1"]);
  assert.equal(matches(MESSAGES[0], { ...NO_MESSAGE_FILTER, starredOnly: true, direction: "sent" }), false);
});

test("newest first by default; Sent's first click when it is already the sort reverses it to oldest first", () => {
  assert.deepEqual(ids(sortMessages(MESSAGES, DEFAULT_MESSAGE_SORT)), ["m5", "m4", "m3", "m2", "m1"]);
  const oldest = nextSort(DEFAULT_MESSAGE_SORT, "sent");
  assert.deepEqual(oldest, { key: "sent", ascending: true });
  assert.deepEqual(ids(sortMessages(MESSAGES, oldest)), ["m1", "m2", "m3", "m4", "m5"]);
  assert.deepEqual(nextSort(oldest, "sent"), DEFAULT_MESSAGE_SORT);
});

test("Member and Subject sort A to Z on the first click, ignoring capitals, and reverse on the second", () => {
  const byMember = nextSort(DEFAULT_MESSAGE_SORT, "member");
  assert.deepEqual(byMember, { key: "member", ascending: true });
  // Ties (the two from or to Kim) keep the order they came in.
  assert.deepEqual(ids(sortMessages(MESSAGES, byMember)), ["m2", "m5", "m1", "m4", "m3"]);
  const bySubject = nextSort(byMember, "subject");
  assert.deepEqual(ids(sortMessages(MESSAGES, bySubject)), ["m1", "m4", "m2", "m5", "m3"]);
  assert.deepEqual(ids(sortMessages(MESSAGES, nextSort(bySubject, "subject"))), ["m3", "m5", "m2", "m4", "m1"]);
});

test("a reply's subject starts Re: once, never twice, and stays within the longest subject", () => {
  assert.equal(replySubject("Lunch"), "Re: Lunch");
  assert.equal(replySubject(" Re: Lunch "), "Re: Lunch");
  assert.equal(replySubject("RE:Lunch"), "RE:Lunch");
  assert.equal(replySubject("x".repeat(SUBJECT_MAX)).length, SUBJECT_MAX);
});

test("the Direction column names each direction", () => {
  assert.deepEqual([directionLabel("from"), directionLabel("to"), directionLabel("self")], ["From", "To", "Note to yourself"]);
});
