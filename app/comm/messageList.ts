/**
 * What Comm's Async mode shows (Messaging.tsx), read on the server through
 * the member's own session: the messages they sent or received, their own
 * Star and Trash marks, the members they can write to, and why they cannot
 * send, if they cannot. Moved here from Your profile when Messages moved into
 * Comm (WC-234, Dane's "C").
 *
 * Members are named only as their profile lets other members see them; no
 * email address is read or passed on.
 */
import { mayDo, ROLES, STARTING_ROLE_PERMISSIONS, type RoleKey } from "../../core/members.ts";
import { listMessageMarks, listMessages, unmarked, type MessageMark, type SavedMessage } from "../../core/messages.ts";
import { listMembers, readRolesAndPermissions, type MemberRow } from "../lib/memberRoleStore";
import { supabaseMessageStore } from "../lib/messageStore";
import type { supabaseForRequest } from "../lib/supabase";
import { shownName } from "../members/memberView";
import type { Recipient, ShownMessage } from "./Messaging";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** Messages and join dates are shown in Mountain time, Dane's own. */
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

export type Read<T> = { value: T; error: null } | { value: null; error: string };

export async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Everyone but the member, by the name their profile shows; two members who show the same name are told apart by when they joined. */
function recipientsFrom(members: MemberRow[], me: string): Recipient[] {
  const others = members.filter((m) => m.memberId !== me);
  const count = new Map<string, number>();
  for (const m of others) count.set(shownName(m), (count.get(shownName(m)) ?? 0) + 1);
  return others
    .map((m) => ({
      memberId: m.memberId,
      label: (count.get(shownName(m)) ?? 0) > 1 ? `${shownName(m)} (joined ${DAY.format(new Date(m.joinedAt))})` : shownName(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }));
}

function shownMessages(messages: SavedMessage[], me: string, members: MemberRow[] | null, marks: Map<string, MessageMark>): ShownMessage[] {
  const byId = new Map((members ?? []).map((m) => [m.memberId, shownName(m)]));
  return messages.map((m) => {
    const direction = m.senderId === me && m.recipientId === me ? "self" : m.senderId === me ? "to" : "from";
    const otherId = direction === "from" ? m.senderId : m.recipientId;
    const mark = marks.get(m.id) ?? unmarked(m.id);
    return {
      id: m.id,
      direction,
      otherId,
      other: byId.get(otherId) ?? "a member",
      subject: m.subject,
      body: m.body,
      sentAt: m.sentAt,
      when: WHEN.format(new Date(m.sentAt)),
      starred: mark.starred,
      trashed: mark.trashedAt !== null,
    };
  });
}

/** Why the member cannot send, or null if they can. */
function sendBlockedBy(role: Read<RoleKey>, grants: Readonly<Record<string, readonly string[]>>, members: Read<MemberRow[]>): string | null {
  if (role.error !== null) return `Your role could not be loaded, so Send Message is off: ${role.error}. Try reloading the page.`;
  if (!mayDo(role.value, "member.message", grants)) {
    return `Your role, ${ROLES.find((r) => r.key === role.value)?.name ?? role.value}, cannot send messages yet.`;
  }
  if (members.error !== null) return `The list of members could not be loaded, so there is no one to pick: ${members.error}. Try reloading the page.`;
  return null;
}

/** Everything Messaging.tsx takes, each part saying why when it could not be read (rules 6 and 7). */
export interface MessagingData {
  messages: ShownMessage[];
  readError: string | null;
  marksError: string | null;
  recipients: Recipient[];
  sendBlocked: string | null;
}

export async function loadMessaging(supabase: Client, me: string, role: Read<RoleKey>): Promise<MessagingData> {
  const store = supabaseMessageStore(supabase);
  const [lists, members, messages, marks] = await Promise.all([
    read(() => readRolesAndPermissions(supabase)),
    read(() => listMembers(supabase)),
    read(() => listMessages(store, me)),
    read(() => listMessageMarks(store, me)),
  ]);
  // The database's grants when they could be read; the starting ones
  // otherwise. send_message checks the database's own either way.
  const grants = lists.value?.grants ?? STARTING_ROLE_PERMISSIONS;
  return {
    messages: messages.value ? shownMessages(messages.value, me, members.value, marks.value ?? new Map()) : [],
    readError: messages.error,
    marksError: marks.error,
    recipients: members.value ? recipientsFrom(members.value, me) : [],
    sendBlocked: sendBlockedBy(role, grants, members),
  };
}
