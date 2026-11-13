/**
 * How the chat window arranges what the page read: who a chat is with, the
 * order of the list, the start of the last message and when it was sent.
 * Plain functions with their own tests (chatView.test.ts): nothing here reads
 * or writes the database.
 */
import type { Chat, ChatMessage } from "../../core/chat.ts";

/** A chat as the list shows it: who it is with and its last message. */
export interface ChatListItem {
  id: string;
  /** The other member's id; null if they are gone. */
  otherId: string | null;
  otherName: string;
  /** The other member's avatar symbol. */
  otherSymbol: string;
  /** The newest message, or null when nothing has been said yet. */
  last: { body: string; sentAt: string; mine: boolean } | null;
  /** When anything last happened: the newest message, or when it was started. */
  activeAt: string;
}

/** What a member the page could not name is called. */
export const SOMEONE = "A member";

/** The other member in a two-person chat, or null if only the viewer is left in it. */
export function chatPartner(chat: Pick<Chat, "memberIds">, me: string): string | null {
  return chat.memberIds.find((id) => id !== me) ?? null;
}

/**
 * The chats as the list shows them, newest activity first: a chat with a
 * new message moves to the top, and one nobody has written in yet sorts by
 * when it was started.
 */
export function chatList(
  chats: Chat[],
  latest: ReadonlyMap<string, ChatMessage>,
  me: string,
  who: (memberId: string | null) => { name: string; symbol: string },
): ChatListItem[] {
  return chats
    .map((chat) => {
      const otherId = chatPartner(chat, me);
      const person = who(otherId);
      const message = latest.get(chat.id) ?? null;
      const last = message ? { body: message.body, sentAt: message.sentAt, mine: message.senderId === me } : null;
      const activeAt = message && message.sentAt > chat.createdAt ? message.sentAt : chat.createdAt;
      return { id: chat.id, otherId, otherName: person.name, otherSymbol: person.symbol, last, activeAt };
    })
    .sort((a, b) => (a.activeAt < b.activeAt ? 1 : a.activeAt > b.activeAt ? -1 : 0));
}

/** The start of a message for the list: its text on one line, cut to `max` characters with an ellipsis. */
export function preview(body: string, max = 60): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

const ZONE = "America/Denver";
const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" });
const DATE_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * When a message was sent, in Mountain time (Dane's own): the time alone for
 * today, the day and time for earlier this year, and the full date before
 * that.
 */
export function sentLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (DATE_KEY.format(at) === DATE_KEY.format(now)) return CLOCK.format(at);
  const sameYear = DATE_KEY.format(at).slice(0, 4) === DATE_KEY.format(now).slice(0, 4);
  return `${(sameYear ? DAY : DAY_YEAR).format(at)}, ${CLOCK.format(at)}`;
}

/** The list's short time: the clock for today, the day otherwise. */
export function listTimeLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (DATE_KEY.format(at) === DATE_KEY.format(now)) return CLOCK.format(at);
  const sameYear = DATE_KEY.format(at).slice(0, 4) === DATE_KEY.format(now).slice(0, 4);
  return (sameYear ? DAY : DAY_YEAR).format(at);
}

/** A chat id is a UUID; anything else cannot be a chat, so it is never asked for. */
export const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a key press in the send box sends: Enter alone does; Shift+Enter makes a new line, and so does Enter while an input method is composing. */
export function sendsOnKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}
