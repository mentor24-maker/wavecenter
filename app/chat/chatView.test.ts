import test from "node:test";
import assert from "node:assert/strict";
import type { Chat, ChatMessage } from "../../core/chat.ts";
import { CHAT_ID, SOMEONE, chatList, chatPartner, listTimeLabel, newestFromOthers, preview, sendsOnKey, sentLabel } from "./chatView.ts";

const chat = (id: string, memberIds: string[], createdAt: string): Chat => ({ id, taskId: null, memberIds, createdBy: memberIds[0], createdAt });
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
    id: "a", otherId: "lee", otherName: "Lee", otherSymbol: "🌊",
    last: { body: "newest of all", sentAt: "2026-11-13T09:00:00Z", mine: false },
    activeAt: "2026-11-13T09:00:00Z",
    unread: 0,
  });
  assert.equal(list[1].last, null);
  assert.equal(list[2].last?.mine, true);
});

test("each chat in the list carries its unread count; a chat missing from the counts has none", () => {
  const chats = [chat("a", ["me", "lee"], "2026-11-10T10:00:00Z"), chat("b", ["sam", "me"], "2026-11-11T10:00:00Z")];
  const list = chatList(chats, new Map(), "me", who, new Map([["a", 3]]));
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
