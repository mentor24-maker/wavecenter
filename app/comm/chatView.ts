/**
 * How the chat window arranges what the page read: who a chat is with, the
 * order of the list, the start of the last message and when it was sent.
 * Plain functions with their own tests (chatView.test.ts): nothing here reads
 * or writes the database.
 */
import { chatSubject, type Chat, type ChatMessage } from "../../core/chat.ts";

/**
 * What a chat is about, as the window labels it: a task (with its title, or
 * null when the title could not be read), a task since deleted, or nothing.
 */
export type ChatTopic = { kind: "task"; taskId: string; title: string | null } | { kind: "deleted-task" } | null;

/** The label for a chat about a task whose title could not be read. */
export const A_TASK = "a task";
/** The label for a chat whose task was deleted. */
export const DELETED_TASK = "about a deleted task";

/** What `chat` is about, with task titles looked up in `titles` (task id → title). */
export function chatTopic(chat: Pick<Chat, "taskId" | "aboutATask">, titles: ReadonlyMap<string, string>): ChatTopic {
  const subject = chatSubject(chat);
  if (subject.kind === "task") return { kind: "task", taskId: subject.taskId, title: titles.get(subject.taskId) ?? null };
  return subject.kind === "deleted-task" ? { kind: "deleted-task" } : null;
}

/** A chat as the list shows it: who it is with and its last message. */
export interface ChatListItem {
  id: string;
  /** The task it is about, if any. */
  topic: ChatTopic;
  /** The other member's id; null if they are gone. */
  otherId: string | null;
  otherName: string;
  /** The other member's avatar symbol. */
  otherSymbol: string;
  /** The newest message, or null when nothing has been said yet. */
  last: { body: string; sentAt: string; mine: boolean } | null;
  /** When anything last happened: the newest message, or when it was started. */
  activeAt: string;
  /** How many messages in it the viewer has not read yet (WC-176). */
  unread: number;
}

/**
 * The browser event that tells the header's Chat badge to count again: sent
 * when the open chat has been marked read and when a new message arrives.
 */
export const CHAT_UNREAD_EVENT = "wavecenter:chat-unread-changed";

/** The newest message in `messages` that someone else sent: its id, or null. Opening a chat marks it read again whenever this changes. */
export function newestFromOthers(messages: Pick<ChatMessage, "id" | "senderId">[], me: string): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].senderId !== me) return messages[i].id;
  return null;
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
  titles: ReadonlyMap<string, string> = new Map(),
  unread: ReadonlyMap<string, number> = new Map(),
): ChatListItem[] {
  return chats
    .map((chat) => {
      const otherId = chatPartner(chat, me);
      const person = who(otherId);
      const message = latest.get(chat.id) ?? null;
      const last = message ? { body: message.body, sentAt: message.sentAt, mine: message.senderId === me } : null;
      const activeAt = message && message.sentAt > chat.createdAt ? message.sentAt : chat.createdAt;
      return { id: chat.id, topic: chatTopic(chat, titles), otherId, otherName: person.name, otherSymbol: person.symbol, last, activeAt, unread: unread.get(chat.id) ?? 0 };
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

/**
 * A refused start, said once: "No chat was started." goes in front only when
 * the reason does not already say so (WC-175 review: "No chat was started.
 * There is no task ... so no chat was started.").
 */
export function notStarted(reason: string): string {
  return /no chat was started/i.test(reason) ? reason : `No chat was started. ${reason}`;
}

/** A member the contact selector offers: their id and the name their profile shows. */
export interface ChatPartnerOption {
  id: string;
  name: string;
}

/**
 * The members the Sync mode's contact selector offers (WC-235): everyone but
 * the viewer, A–Z by the name their profile shows (case-blind), so the
 * viewer can never start a chat with themself. One member per chat today; a
 * group picker can take this same list later.
 */
export function chatPartnerOptions(members: { memberId: string; name: string }[], me: string): ChatPartnerOption[] {
  return members
    .filter((m) => m.memberId !== me)
    .map((m) => ({ id: m.memberId, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The open chat's messages, newest first (WC-235: "Keep the most recent entries on top"). A copy; the input is untouched. */
export function newestFirst<T extends Pick<ChatMessage, "sentAt">>(messages: readonly T[]): T[] {
  return [...messages].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
}

/** The words of a search, lower-cased; none for a blank search. */
function searchWords(query: string): string[] {
  return query.toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
}

/**
 * The messages whose body holds every word of `query`, case-blind, in their
 * order (WC-235: "a search field to search the conversation body"). A blank
 * search keeps them all. Bodies are compared as plain text, never as HTML.
 */
export function searchMessages<T extends Pick<ChatMessage, "body">>(messages: readonly T[], query: string): T[] {
  const words = searchWords(query);
  if (words.length === 0) return [...messages];
  return messages.filter((m) => {
    const body = m.body.toLocaleLowerCase("en");
    return words.every((w) => body.includes(w));
  });
}

/** Whether `query` searches at all: anything but blank. */
export function isSearching(query: string): boolean {
  return searchWords(query).length > 0;
}

/**
 * The days a member picked to see the chat between (WC-245): each a
 * Mountain-time day as `<input type="date">` gives it ("YYYY-MM-DD"), or ""
 * for no limit on that side. Both ends are whole days and inclusive.
 */
export interface DateRange {
  from: string;
  to: string;
}

/** No date limit at all. */
export const ANY_DATE: DateRange = { from: "", to: "" };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A picked day, or "" when the box is blank or holds anything but a day. */
function pickedDay(value: string): string {
  const v = value.trim();
  return DAY_KEY.test(v) ? v : "";
}

/** Whether `range` limits the dates at all. */
export function isDateFiltering(range: DateRange): boolean {
  return pickedDay(range.from) !== "" || pickedDay(range.to) !== "";
}

/** Whether the From day is after the To day, so nothing can fall between them. */
export function isRangeBackwards(range: DateRange): boolean {
  const from = pickedDay(range.from);
  const to = pickedDay(range.to);
  return from !== "" && to !== "" && from > to;
}

/**
 * The messages sent within `range`, judged by their Mountain-time day (the
 * same day the date breaks show), in their order. A blank From starts at the
 * first message, a blank To runs up to now; both ends inclusive. A message
 * whose time cannot be read is kept only while no date is picked.
 */
export function messagesInRange<T extends Pick<ChatMessage, "sentAt">>(messages: readonly T[], range: DateRange): T[] {
  const from = pickedDay(range.from);
  const to = pickedDay(range.to);
  if (from === "" && to === "") return [...messages];
  return messages.filter((m) => {
    const at = new Date(m.sentAt);
    if (Number.isNaN(at.getTime())) return false;
    const key = DATE_KEY.format(at);
    return (from === "" || key >= from) && (to === "" || key <= to);
  });
}

/** A picked day as the lines say it: "Nov 1", with the year when it is not this year. */
function dayWords(key: string, now: Date): string {
  const [y, m, d] = key.split("-").map(Number);
  // Noon UTC is the same calendar day in Mountain time.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return (key.slice(0, 4) === DATE_KEY.format(now).slice(0, 4) ? DAY : DAY_YEAR).format(at);
}

/** The range in words: "from Nov 1 to Nov 20", "on Nov 1" for one day, "from Nov 1", "up to Nov 20", or "" for none. */
export function rangeWords(range: DateRange, now: Date = new Date()): string {
  const from = pickedDay(range.from);
  const to = pickedDay(range.to);
  if (from && from === to) return `on ${dayWords(from, now)}`;
  if (from && to) return `from ${dayWords(from, now)} to ${dayWords(to, now)}`;
  if (from) return `from ${dayWords(from, now)}`;
  if (to) return `up to ${dayWords(to, now)}`;
  return "";
}

/** The plain note when the From day is after the To day (rule 7: never a bare empty box). */
export function backwardsRangeLine(range: DateRange, now: Date = new Date()): string {
  return `The From date (${dayWords(pickedDay(range.from), now)}) is after the To date (${dayWords(pickedDay(range.to), now)}), so no message can fall between them. Change one of the dates.`;
}

/** The plain line when a search finds nothing (rule 7), naming the dates when some are picked. */
export function noMatchLine(query: string, range: DateRange = ANY_DATE, now: Date = new Date()): string {
  const dates = rangeWords(range, now);
  if (!isSearching(query)) return `No messages ${dates || "match"}.`;
  return `No messages match "${query.trim()}"${dates ? ` ${dates}` : ""}.`;
}

/** The line over a search's results: how many of the chat's messages match, and between which dates. */
export function matchCountLine(shown: number, total: number, query: string, range: DateRange = ANY_DATE, now: Date = new Date()): string {
  const dates = rangeWords(range, now);
  if (!isSearching(query)) return `${shown} of ${total} ${total === 1 ? "message was" : "messages were"} sent ${dates}.`;
  return `${shown} of ${total} ${total === 1 ? "message matches" : "messages match"} "${query.trim()}"${dates ? ` ${dates}` : ""}.`;
}

const WEEKDAY_DAY = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long", month: "short", day: "numeric" });
const WEEKDAY_DAY_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long", month: "short", day: "numeric", year: "numeric" });

/** The label a date break shows when a message's time cannot be read. */
export const UNKNOWN_DAY = "Unknown date";

/** The Mountain-time day (YYYY-MM-DD) before `key`. */
function dayBefore(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * The heading of a date break (WC-242), in Mountain time: "Today",
 * "Yesterday", the weekday and date this year ("Tuesday, Nov 24"), and the
 * year too before this year.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return UNKNOWN_DAY;
  const key = DATE_KEY.format(at);
  const today = DATE_KEY.format(now);
  if (key === today) return "Today";
  if (key === dayBefore(today)) return "Yesterday";
  return (key.slice(0, 4) === today.slice(0, 4) ? WEEKDAY_DAY : WEEKDAY_DAY_YEAR).format(at);
}

/** A message's clock time alone, in Mountain time: what it shows under a date break, which already names the day. */
export function clockLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : CLOCK.format(at);
}

/** A message as the conversation lays it out: with the date break that goes before it, or null when it is on the same day as the one before. */
export interface DayBreakRow<T> {
  /** The break before this message: its Mountain-time day and label. */
  day: { key: string; label: string } | null;
  message: T;
}

/**
 * Where a new day starts in `messages`, taken in the order shown (WC-242:
 * "a div between dates"). The first message always gets a break, and so does
 * every message on a different Mountain-time day from the one shown before
 * it, so it works oldest-first and newest-first alike.
 */
export function withDayBreaks<T extends Pick<ChatMessage, "sentAt">>(messages: readonly T[], now: Date = new Date()): DayBreakRow<T>[] {
  let previous: string | null = null;
  return messages.map((message) => {
    const at = new Date(message.sentAt);
    const key = Number.isNaN(at.getTime()) ? "" : DATE_KEY.format(at);
    const day = key === previous ? null : { key, label: dayLabel(message.sentAt, now) };
    previous = key;
    return { day, message };
  });
}
