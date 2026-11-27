import test from "node:test";
import assert from "node:assert/strict";
import type { Chat, ChatMessage } from "../../core/chat.ts";
import { CHAT_ID, SOMEONE, UNKNOWN_DAY, chatList, clockLabel, dayLabel, withDayBreaks, chatPartnerOptions, chatTopic, chatPartner, isSearching, isDateFiltering, isRangeBackwards, messagesInRange, rangeWords, backwardsRangeLine, ANY_DATE, listTimeLabel, matchCountLine, newestFirst, newestFromOthers, noMatchLine, notStarted, preview, searchMessages, sendsOnKey, sentLabel } from "./chatView.ts";

const chat = (id: string, memberIds: string[], createdAt: string): Chat => ({ id, taskId: null, aboutATask: false, memberIds, createdBy: memberIds[0], createdAt });
const message = (chatId: string, senderId: string, body: string, sentAt: string): ChatMessage => ({
  id: `${chatId}-${sentAt}`, chatId, senderId, body, tool: "wavecenter", sentAt,
});
const names: Record<string, string> = { lee: "Lee", sam: "Sam", kim: "Kim" };
const who = (id: string | null) => ({ name: (id && names[id]) || SOMEONE, symbol: id ? "🌊" : "👤" });

test("the other member in a chat is whoever is not you; a chat you are alone in has nobody", () => {
  assert.equal(chatPartner({ memberIds: ["me", "lee"] }, "me"), "lee");
  assert.equal(chatPartner({ memberIds: ["lee", "me"] }, "me"), "lee");
  assert.equal(chatPartner({ memberIds: ["me"] }, "me"), null);
});

test("the list puts the chat with the newest activity first, a quiet chat by when it was started", () => {
  const chats = [
    chat("a", ["me", "lee"], "2026-11-10T10:00:00Z"),
    chat("b", ["sam", "me"], "2026-11-11T10:00:00Z"),
    chat("c", ["me", "kim"], "2026-11-12T10:00:00Z"),
  ];
  const latest = new Map([
    ["a", message("a", "lee", "newest of all", "2026-11-13T09:00:00Z")],
    ["b", message("b", "me", "older", "2026-11-11T11:00:00Z")],
  ]);
  const list = chatList(chats, latest, "me", who);
  assert.deepEqual(list.map((c) => c.id), ["a", "c", "b"]);
  assert.deepEqual(list[0], {
    id: "a", topic: null, otherId: "lee", otherName: "Lee", otherSymbol: "🌊",
    last: { body: "newest of all", sentAt: "2026-11-13T09:00:00Z", mine: false },
    activeAt: "2026-11-13T09:00:00Z",
    unread: 0,
  });
  assert.equal(list[1].last, null);
  assert.equal(list[2].last?.mine, true);
});

test("each chat in the list carries its unread count; a chat missing from the counts has none", () => {
  const chats = [chat("a", ["me", "lee"], "2026-11-10T10:00:00Z"), chat("b", ["sam", "me"], "2026-11-11T10:00:00Z")];
  const list = chatList(chats, new Map(), "me", who, new Map(), new Map([["a", 3]]));
  assert.deepEqual(list.map((c) => [c.id, c.unread]), [["b", 0], ["a", 3]]);
});

test("the newest message from someone else is what marks an open chat read again", () => {
  assert.equal(newestFromOthers([], "me"), null);
  assert.equal(newestFromOthers([{ id: "1", senderId: "me" }], "me"), null, "only your own: nothing to read");
  assert.equal(newestFromOthers([{ id: "1", senderId: "kim" }, { id: "2", senderId: "me" }], "me"), "1", "your reply does not change it");
  assert.equal(newestFromOthers([{ id: "1", senderId: "kim" }, { id: "2", senderId: "me" }, { id: "3", senderId: "kim" }], "me"), "3");
});

test("a chat whose other member is gone is still listed, under a plain name", () => {
  const [item] = chatList([chat("a", ["me"], "2026-11-10T10:00:00Z")], new Map(), "me", who);
  assert.equal(item.otherId, null);
  assert.equal(item.otherName, SOMEONE);
});

test("a preview is the message on one line, cut with an ellipsis", () => {
  assert.equal(preview("hello"), "hello");
  assert.equal(preview("  two\nlines\t here "), "two lines here");
  const long = "word ".repeat(30);
  const cut = preview(long, 20);
  assert.equal(cut.length <= 20, true);
  assert.equal(cut.endsWith("…"), true);
  assert.equal(preview("x".repeat(60), 60), "x".repeat(60));
});

test("times are Mountain time: the clock today, the day earlier this year, the full date before", () => {
  const now = new Date("2026-11-13T18:00:00Z"); // 11:00 AM in Denver
  assert.equal(sentLabel("2026-11-13T15:05:00Z", now), "8:05 AM");
  // 2:30 AM UTC on the 13th is still the evening of the 12th in Denver.
  assert.equal(sentLabel("2026-11-13T02:30:00Z", now), "Nov 12, 7:30 PM");
  assert.equal(sentLabel("2025-12-31T20:00:00Z", now), "Dec 31, 2025, 1:00 PM");
  assert.equal(listTimeLabel("2026-11-13T15:05:00Z", now), "8:05 AM");
  assert.equal(listTimeLabel("2026-11-01T15:05:00Z", now), "Nov 1");
  assert.equal(listTimeLabel("2025-11-01T15:05:00Z", now), "Nov 1, 2025");
  assert.equal(sentLabel("not a date", now), "");
});

test("Enter sends; Shift+Enter, and Enter while composing, make a new line", () => {
  assert.equal(sendsOnKey({ key: "Enter", shiftKey: false }), true);
  assert.equal(sendsOnKey({ key: "Enter", shiftKey: true }), false);
  assert.equal(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(sendsOnKey({ key: "a", shiftKey: false }), false);
});

test("only a UUID can be a chat id", () => {
  assert.equal(CHAT_ID.test("64ce0cfd-f297-4d66-9740-257d8f3a8707"), true);
  assert.equal(CHAT_ID.test("not-a-chat"), false);
  assert.equal(CHAT_ID.test("64ce0cfd-f297-4d66-9740-257d8f3a8707x"), false);
});

test("a chat's topic: a task with its title, a task whose title is unknown, a deleted task, or none", () => {
  const titles = new Map([["task-1", "Write the plan"]]);
  assert.deepEqual(chatTopic({ taskId: "task-1", aboutATask: true }, titles), { kind: "task", taskId: "task-1", title: "Write the plan" });
  assert.deepEqual(chatTopic({ taskId: "task-2", aboutATask: true }, titles), { kind: "task", taskId: "task-2", title: null });
  assert.deepEqual(chatTopic({ taskId: null, aboutATask: true }, titles), { kind: "deleted-task" });
  assert.equal(chatTopic({ taskId: null, aboutATask: false }, titles), null);
  const about = { ...chat("c1", ["me", "kim"], "2026-11-12T10:00:00Z"), taskId: "task-1", aboutATask: true };
  const [item] = chatList([about], new Map(), "me", () => ({ name: "Kim", symbol: "*" }), titles);
  assert.deepEqual(item.topic, { kind: "task", taskId: "task-1", title: "Write the plan" });
});

test("a refused start says no chat was started exactly once", () => {
  assert.equal(notStarted("There is no such member."), "No chat was started. There is no such member.");
  assert.equal(
    notStarted("There is no task of that id you may read, so no chat was started."),
    "There is no task of that id you may read, so no chat was started.",
  );
  assert.equal(notStarted("You are signed out, so no chat was started. Reload the page and log in again."), "You are signed out, so no chat was started. Reload the page and log in again.");
});

test("the contact selector offers every other member A–Z, never yourself", () => {
  const options = chatPartnerOptions(
    [
      { memberId: "me", name: "Dane" },
      { memberId: "sam", name: "sam" },
      { memberId: "lee", name: "Lee" },
      { memberId: "kim", name: "Kim" },
    ],
    "me",
  );
  assert.deepEqual(options, [
    { id: "kim", name: "Kim" },
    { id: "lee", name: "Lee" },
    { id: "sam", name: "sam" },
  ]);
  assert.deepEqual(chatPartnerOptions([{ memberId: "me", name: "Dane" }], "me"), []);
});

test("the open chat shows the newest message first, without changing the list it was given", () => {
  const messages = [
    message("a", "me", "first", "2026-11-10T10:00:00Z"),
    message("a", "lee", "second", "2026-11-10T10:01:00Z"),
    message("a", "me", "third", "2026-11-10T10:02:00Z"),
  ];
  assert.deepEqual(newestFirst(messages).map((m) => m.body), ["third", "second", "first"]);
  assert.deepEqual(messages.map((m) => m.body), ["first", "second", "third"]);
});

test("search finds messages holding every word typed, case-blind, and a blank search keeps them all", () => {
  const messages = [
    message("a", "me", "Hello from the top", "2026-11-10T10:00:00Z"),
    message("a", "lee", "hello again", "2026-11-10T10:01:00Z"),
    message("a", "me", "<b>bold</b> is just text", "2026-11-10T10:02:00Z"),
  ];
  assert.deepEqual(searchMessages(messages, "HELLO").map((m) => m.body), ["Hello from the top", "hello again"]);
  assert.deepEqual(searchMessages(messages, "  top   hello ").map((m) => m.body), ["Hello from the top"]);
  assert.deepEqual(searchMessages(messages, "<b>").map((m) => m.body), ["<b>bold</b> is just text"]);
  assert.deepEqual(searchMessages(messages, "zzz"), []);
  assert.equal(searchMessages(messages, "   ").length, 3);
  assert.equal(isSearching("   "), false);
  assert.equal(isSearching(" hi "), true);
});

test("search says plainly when nothing matches and how many do", () => {
  assert.equal(noMatchLine("  zzz "), 'No messages match "zzz".');
  assert.equal(matchCountLine(2, 9, "hello"), '2 of 9 messages match "hello".');
  assert.equal(matchCountLine(1, 1, "hi"), '1 of 1 message matches "hi".');
});

test("a date break says Today, Yesterday, the weekday and date this year, and the year before this year", () => {
  const now = new Date("2026-11-26T19:00:00Z"); // Thu Nov 26, noon Mountain
  assert.equal(dayLabel("2026-11-26T15:00:00Z", now), "Today");
  assert.equal(dayLabel("2026-11-25T15:00:00Z", now), "Yesterday");
  assert.equal(dayLabel("2026-11-24T15:00:00Z", now), "Tuesday, Nov 24");
  assert.equal(dayLabel("2025-11-24T15:00:00Z", now), "Monday, Nov 24, 2025");
  assert.equal(dayLabel("not a date", now), UNKNOWN_DAY);
});

test("Yesterday works across a month and a year end", () => {
  assert.equal(dayLabel("2026-11-30T19:00:00Z", new Date("2026-12-01T19:00:00Z")), "Yesterday");
  assert.equal(dayLabel("2026-12-31T19:00:00Z", new Date("2027-01-01T19:00:00Z")), "Yesterday");
});

test("days are Mountain-time days: 11 pm Mountain is still that day, not the next UTC day", () => {
  const now = new Date("2026-11-26T19:00:00Z");
  // 2026-11-26T06:00Z is 11 pm Mountain on Nov 25.
  assert.equal(dayLabel("2026-11-26T06:00:00Z", now), "Yesterday");
  const rows = withDayBreaks([{ sentAt: "2026-11-26T05:30:00Z" }, { sentAt: "2026-11-26T06:00:00Z" }, { sentAt: "2026-11-26T07:30:00Z" }], now);
  assert.deepEqual(rows.map((r) => r.day?.label ?? null), ["Yesterday", null, "Today"]);
});

test("a break goes before the first message of each day, oldest first and newest first alike", () => {
  const now = new Date("2026-11-26T19:00:00Z");
  const oldestFirst = [
    { sentAt: "2026-11-24T15:00:00Z" },
    { sentAt: "2026-11-25T15:00:00Z" },
    { sentAt: "2026-11-25T16:00:00Z" },
    { sentAt: "2026-11-26T15:00:00Z" },
  ];
  assert.deepEqual(withDayBreaks(oldestFirst, now).map((r) => r.day?.label ?? null), ["Tuesday, Nov 24", "Yesterday", null, "Today"]);
  const newest = newestFirst(oldestFirst);
  const rows = withDayBreaks(newest, now);
  assert.deepEqual(rows.map((r) => r.day?.label ?? null), ["Today", "Yesterday", null, "Tuesday, Nov 24"]);
  assert.deepEqual(rows.map((r) => r.message), newest, "every message once, in the order given");
});

test("a chat all from one day gets one break, at the top; no messages, no breaks", () => {
  const now = new Date("2026-11-26T19:00:00Z");
  const rows = withDayBreaks([{ sentAt: "2026-11-26T15:00:00Z" }, { sentAt: "2026-11-26T16:00:00Z" }], now);
  assert.deepEqual(rows.map((r) => r.day?.label ?? null), ["Today", null]);
  assert.deepEqual(withDayBreaks([], now), []);
});

test("under a break a message shows its clock time alone, in Mountain time", () => {
  assert.equal(clockLabel("2026-11-26T06:00:00Z"), "11:00 PM");
  assert.equal(clockLabel("nope"), "");
});

// WC-245: From and To days on the Discussion panel, Mountain time, both ends inclusive.
const dated = [
  message("c", "lee", "Halloween hello", "2026-10-31T18:00:00Z"),
  // 11:30pm Nov 1 in Mountain time (MST, -7, after daylight time ended that morning): still Nov 1 there, though Nov 2 in UTC.
  message("c", "sam", "late on the first", "2026-11-02T06:30:00Z"),
  // 12:30am Nov 2 in Mountain time.
  message("c", "lee", "just after midnight hello", "2026-11-02T07:30:00Z"),
  message("c", "sam", "mid month", "2026-11-15T17:00:00Z"),
  message("c", "lee", "late month hello", "2026-11-20T17:00:00Z"),
];
const bodies = (ms: { body: string }[]) => ms.map((m) => m.body);
const now = new Date("2026-11-26T19:00:00Z");

test("a From day alone hides what was sent before that Mountain-time day", () => {
  assert.deepEqual(bodies(messagesInRange(dated, { from: "2026-11-15", to: "" })), ["mid month", "late month hello"]);
});

test("a To day alone hides what was sent after that Mountain-time day", () => {
  assert.deepEqual(bodies(messagesInRange(dated, { from: "", to: "2026-11-01" })), ["Halloween hello", "late on the first"]);
});

test("From and To together keep both ends, inclusive, split at Mountain-time midnight", () => {
  assert.deepEqual(bodies(messagesInRange(dated, { from: "2026-11-01", to: "2026-11-01" })), ["late on the first"]);
  assert.deepEqual(bodies(messagesInRange(dated, { from: "2026-11-02", to: "2026-11-15" })), ["just after midnight hello", "mid month"]);
  assert.deepEqual(bodies(messagesInRange(dated, { from: "2026-10-31", to: "2026-11-20" })), bodies(dated));
});

test("no dates keeps every message, and junk in a date box counts as blank", () => {
  assert.equal(messagesInRange(dated, ANY_DATE).length, 5);
  assert.equal(messagesInRange(dated, { from: "soon", to: "" }).length, 5);
  assert.equal(isDateFiltering(ANY_DATE), false);
  assert.equal(isDateFiltering({ from: "", to: "2026-11-01" }), true);
  assert.deepEqual(messagesInRange([message("c", "lee", "?", "not a time")], { from: "2026-11-01", to: "" }), []);
});

test("a From day after the To day is caught and said plainly", () => {
  const range = { from: "2026-11-20", to: "2026-11-01" };
  assert.equal(isRangeBackwards(range), true);
  assert.equal(isRangeBackwards({ from: "2026-11-01", to: "2026-11-01" }), false);
  assert.equal(isRangeBackwards({ from: "2026-11-20", to: "" }), false);
  assert.equal(backwardsRangeLine(range, now), "The From date (Nov 20) is after the To date (Nov 1), so no message can fall between them. Change one of the dates.");
});

test("words and dates combine: only messages passing both show", () => {
  const range = { from: "2026-11-02", to: "" };
  assert.deepEqual(bodies(messagesInRange(searchMessages(dated, "hello"), range)), ["just after midnight hello", "late month hello"]);
});

test("the count and no-match lines name the dates when some are picked", () => {
  const range = { from: "2026-11-01", to: "2026-11-20" };
  assert.equal(rangeWords(range, now), "from Nov 1 to Nov 20");
  assert.equal(rangeWords({ from: "2026-11-01", to: "2026-11-01" }, now), "on Nov 1");
  assert.equal(rangeWords({ from: "2026-11-01", to: "" }, now), "from Nov 1");
  assert.equal(rangeWords({ from: "", to: "2026-11-20" }, now), "up to Nov 20");
  assert.equal(rangeWords({ from: "2025-12-31", to: "" }, now), "from Dec 31, 2025");
  assert.equal(rangeWords(ANY_DATE, now), "");
  assert.equal(noMatchLine("", range, now), "No messages from Nov 1 to Nov 20.");
  assert.equal(noMatchLine(" x ", range, now), 'No messages match "x" from Nov 1 to Nov 20.');
  assert.equal(noMatchLine("x"), 'No messages match "x".');
  assert.equal(matchCountLine(2, 9, "", range, now), "2 of 9 messages were sent from Nov 1 to Nov 20.");
  assert.equal(matchCountLine(1, 1, "", { from: "", to: "2026-11-20" }, now), "1 of 1 message was sent up to Nov 20.");
  assert.equal(matchCountLine(2, 9, "hello", range, now), '2 of 9 messages match "hello" from Nov 1 to Nov 20.');
  assert.equal(matchCountLine(2, 9, "hello"), '2 of 9 messages match "hello".');
});
