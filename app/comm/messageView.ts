/**
 * How the Messages table in Comm's Async mode is filtered and sorted in the
 * browser, on the messages the page already loaded: nothing here reads or
 * writes the database. Plain functions with their own tests
 * (messageView.test.ts), modelled on the Members table's (memberView.ts).
 */
import { SUBJECT_MAX } from "../../core/messages.ts";

/** The fields of a message the filters and sorts look at. */
export interface ViewMessage {
  id: string;
  /** "from" a message they received, "to" one they sent, "self" a note to themself. */
  direction: "from" | "to" | "self";
  /** The other member's name as their profile allows. */
  other: string;
  subject: string;
  body: string;
  /** When it was sent, as an ISO date. */
  sentAt: string;
  starred: boolean;
  trashed: boolean;
}

/** What the Direction column says. */
export function directionLabel(d: ViewMessage["direction"]): string {
  return d === "from" ? "From" : d === "to" ? "To" : "Note to yourself";
}

export type MessageSortKey = "member" | "subject" | "sent";
export type MessageSort = { key: MessageSortKey; ascending: boolean };

/** Newest first until a heading is clicked. */
export const DEFAULT_MESSAGE_SORT: MessageSort = { key: "sent", ascending: false };

/** The way each column sorts on its first click: A–Z, A–Z, newest first. */
export const FIRST_CLICK_ASCENDING: Record<MessageSortKey, boolean> = { member: true, subject: true, sent: false };

/** One click on a column heading: sort by it, or reverse it if it is already the sort. */
export function nextSort(now: MessageSort, key: MessageSortKey): MessageSort {
  if (now.key === key) return { key, ascending: !now.ascending };
  return { key, ascending: FIRST_CLICK_ASCENDING[key] };
}

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

function compare(a: ViewMessage, b: ViewMessage, key: MessageSortKey): number {
  switch (key) {
    case "member":
      // A note to yourself has no other member; it sorts as "yourself".
      return text(a.direction === "self" ? "yourself" : a.other, b.direction === "self" ? "yourself" : b.other);
    case "subject":
      return text(a.subject, b.subject);
    case "sent":
      return a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0;
  }
}

/** The messages in the chosen order. Ties keep the order they came in. */
export function sortMessages<T extends ViewMessage>(messages: T[], sort: MessageSort): T[] {
  const sign = sort.ascending ? 1 : -1;
  return messages
    .map((m, i) => ({ m, i }))
    .sort((a, b) => sign * compare(a.m, b.m, sort.key) || a.i - b.i)
    .map(({ m }) => m);
}

export interface MessageFilter {
  /** Matched against the other member's name, the subject and the text, ignoring capitals. */
  text: string;
  /** Received: messages to you (notes to yourself too). Sent: messages from you (notes to yourself too). */
  direction: "all" | "received" | "sent";
  starredOnly: boolean;
  /** Show the messages in your trash as well, each with Restore. */
  showTrash: boolean;
}

export const NO_MESSAGE_FILTER: MessageFilter = { text: "", direction: "all", starredOnly: false, showTrash: false };

/** Is any filter narrowing the table? Show trash widens it, so it does not count. */
export function isFiltering(f: MessageFilter): boolean {
  return f.text.trim() !== "" || f.direction !== "all" || f.starredOnly;
}

/** Does this one message pass every filter set? */
export function matches(m: ViewMessage, f: MessageFilter): boolean {
  if (m.trashed && !f.showTrash) return false;
  if (f.starredOnly && !m.starred) return false;
  if (f.direction === "received" && m.direction === "to") return false;
  if (f.direction === "sent" && m.direction === "from") return false;
  const t = f.text.trim().toLowerCase();
  if (t && ![m.other, m.subject, m.body].some((s) => s.toLowerCase().includes(t))) return false;
  return true;
}

export function filterMessages<T extends ViewMessage>(messages: T[], f: MessageFilter): T[] {
  return messages.filter((m) => matches(m, f));
}

/** How many messages are in the trash. */
export function trashCount(messages: ViewMessage[]): number {
  return messages.filter((m) => m.trashed).length;
}

/**
 * The subject a reply starts with: "Re: " and the subject, unless it already
 * starts with "Re:" in any capitals, kept within the longest subject the
 * database takes.
 */
export function replySubject(subject: string): string {
  const s = subject.trim();
  const re = /^re:\s*/i.test(s) ? s : `Re: ${s}`;
  return re.slice(0, SUBJECT_MAX);
}
