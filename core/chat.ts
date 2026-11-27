/**
 * Live chat between members (Dane, 2026-11-12: "So two WaveCenter users could
 * chat with each other in real-time in a dedicated window"; "Any two members,
 * for now"; "Chat's next to and about tasks would be ideal").
 *
 * A chat is a conversation between members, optionally about one task. Its
 * members are a list, not a pair: two, or a group of up to CHAT_MEMBERS_MAX
 * (WC-252, "Let a Comm chat include more than two members"). Separate from
 * messages (core/messages.ts), which are one-way, emailed and carry a
 * subject.
 *
 * The database repeats every rule here (`start_chat` and `send_chat_message`,
 * supabase/migrations/20261112120000_chats.sql; the group form of
 * `start_chat`, 20261128130000_group_chats.sql), so a client that skips core
 * is refused too. Its row-level security lets a member read a chat, its
 * members and its messages only when they are in it; `listChats` and
 * `listChatMessages` drop anything else a store hands back, so a store that
 * reads too much still shows nobody else's conversation.
 *
 * Every message saved is scored for its sender (`sent_a_chat_message`, a
 * granular action), inside the same save: if the engagement cannot be
 * written, the message is not saved either. A new chat is scored the same
 * way for the member who started it (`started_a_chat`); opening a chat that
 * is already there makes nothing, so it scores nothing.
 */
import { CoreError, requireTool } from './tool.ts';

/** The longest chat message the database takes, in characters, after trimming. */
export const CHAT_BODY_MAX = 4000;

/** The most members one chat may have, the member starting it included (WC-252). */
export const CHAT_MEMBERS_MAX = 10;

/** One conversation. */
export interface Chat {
  id: string;
  /** The task it is about; null for a plain chat, or once that task is deleted. */
  taskId: string | null;
  /**
   * Whether it was started about a task. Set once and never changed, so a
   * chat whose task was deleted (taskId null) is still told apart from a
   * plain chat (supabase/migrations/20261113120000_chats_about_a_task.sql).
   */
  aboutATask: boolean;
  /** Everyone in it: two, or a group of up to CHAT_MEMBERS_MAX. */
  memberIds: string[];
  /** Who started it; null once their account is gone. */
  createdBy: string | null;
  /** When it was started, as an ISO date. */
  createdAt: string;
}

/** One thing said in a chat. */
export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  /** The tool that sent it. */
  tool: string;
  /** When it was saved, as an ISO date. */
  sentAt: string;
}

/**
 * What core needs from storage for chats. Every call acts as the signed-in
 * member, as the database's session decides. Each throws if the database
 * refuses or fails; none ever hands back the caller's own input as a success.
 */
export interface ChatStore {
  /**
   * The chat whose members are exactly the signed-in member and
   * `otherMemberIds`, about `taskId` (null: a plain chat): the one already
   * there, or a new one, made on behalf of `tool`. Throws for an unknown
   * member or a task the member may not read.
   */
  start(otherMemberIds: string[], taskId: string | null, tool: string): Promise<{ id: string }>;
  /** Save a message from the signed-in member. Throws if they are not in the chat. */
  send(chatId: string, body: string, tool: string): Promise<{ id: string }>;
  /** The chats `memberId` is in, in any order. */
  chats(memberId: string): Promise<Chat[]>;
  /** The messages of one chat, in any order. Empty for a chat the member is not in. */
  messages(chatId: string): Promise<ChatMessage[]>;
}

/** The other members of a chat to start: one id, or a list of them. */
export type ChatOthers = string | readonly string[];

/** `others` as a list. */
export function chatOthers(others: ChatOthers): string[] {
  return typeof others === 'string' ? [others] : [...others];
}

/**
 * Why `memberId` cannot start a chat with `others`, in plain words, or null
 * if they can: there must be at least one other member, no more than
 * CHAT_MEMBERS_MAX in all (you included), not yourself, and nobody twice.
 * The database checks the rules in this same order, and also that every
 * member exists.
 */
export function startChatProblem(memberId: string, others: ChatOthers): string | null {
  if (!memberId) return 'You are signed out, so no chat was started.';
  const ids = chatOthers(others);
  if (ids.length === 0) return 'Pick at least one other member to chat with.';
  if (ids.length + 1 > CHAT_MEMBERS_MAX) return `A chat can have at most ${CHAT_MEMBERS_MAX} members, you included, so no chat was started.`;
  if (ids.some((id) => !id)) return 'There is no such member.';
  if (ids.includes(memberId)) return 'You cannot start a chat with yourself.';
  if (new Set(ids).size !== ids.length) return 'The same member was picked twice, so no chat was started.';
  return null;
}

/** Whether `chat` is a group chat: more than two members. */
export function isGroupChat(chat: Pick<Chat, 'memberIds'>): boolean {
  return chat.memberIds.length > 2;
}

/** Why a chat message cannot be sent, in plain words, or null if it can. Nothing is saved for a refused message. */
export function chatMessageProblem(body: string): string | null {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text === '') return 'A chat message needs some text.';
  if (text.length > CHAT_BODY_MAX) return `The message is too long: keep it to ${CHAT_BODY_MAX} characters or fewer.`;
  return null;
}

/** Whether `memberId` is in `chat`, and so may read it and write in it. */
export function isInChat(chat: Pick<Chat, 'memberIds'>, memberId: string): boolean {
  return Boolean(memberId) && chat.memberIds.includes(memberId);
}

/**
 * `memberId` starts (or finds) their chat with `otherMemberIds` (one member,
 * or several for a group), about `taskId` if given, on behalf of `tool`.
 * Starting it again with the same set of members, from any of them, finds
 * the same chat. A new chat is scored for `memberId` (`started_a_chat`),
 * naming `tool`; finding one already there is not. Throws a CoreError, with
 * nothing saved, for a chat breaking startChatProblem's rules or a missing
 * tool; a store refusal (an unknown member, a task you may not read) throws
 * too.
 */
export async function startChat(
  store: ChatStore,
  input: { memberId: string; otherMemberIds: ChatOthers; taskId?: string | null },
  tool: string,
): Promise<{ id: string }> {
  const named = requireTool(tool);
  const problem = startChatProblem(input.memberId, input.otherMemberIds);
  if (problem) throw new CoreError(problem);
  const started = await store.start(chatOthers(input.otherMemberIds), input.taskId ?? null, named);
  if (!started?.id) throw new CoreError('The chat did not start. Nothing was saved; try again.');
  return { id: started.id };
}

/**
 * `senderId` says `body` in chat `chatId`, on behalf of `tool`. The text is
 * saved trimmed. Throws a CoreError, with nothing saved, for an empty or
 * over-long message or a missing tool; a store refusal (not in the chat)
 * throws too. A failed save throws: it is never reported as sent.
 */
export async function sendChatMessage(
  store: ChatStore,
  input: { senderId: string; chatId: string; body: string },
  tool: string,
): Promise<{ id: string }> {
  const named = requireTool(tool);
  if (!input.senderId) throw new CoreError('You are signed out, so no message was sent.');
  if (!input.chatId) throw new CoreError('You are not in that chat, so no message was sent.');
  const problem = chatMessageProblem(input.body);
  if (problem) throw new CoreError(problem);
  const saved = await store.send(input.chatId, input.body.trim(), named);
  if (!saved?.id) throw new CoreError('The message did not save. Nothing was sent; try again.');
  return { id: saved.id };
}

/** The chats `memberId` is in, newest first. Any chat they are not in is dropped. A failed read throws. */
export async function listChats(store: ChatStore, memberId: string): Promise<Chat[]> {
  if (!memberId) throw new CoreError('You are signed out, so there are no chats to show.');
  const rows = await store.chats(memberId);
  return rows
    .filter((c) => isInChat(c, memberId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** What a chat is about: a task still there, a task since deleted, or nothing (a plain chat). */
export type ChatSubject = { kind: 'task'; taskId: string } | { kind: 'deleted-task' } | { kind: 'none' };

/** What `chat` is about. */
export function chatSubject(chat: Pick<Chat, 'taskId' | 'aboutATask'>): ChatSubject {
  if (chat.taskId) return { kind: 'task', taskId: chat.taskId };
  return chat.aboutATask ? { kind: 'deleted-task' } : { kind: 'none' };
}

/** Of `chats`, the ones about task `taskId`, in the order given. */
export function chatsAboutTask<T extends Pick<Chat, 'taskId'>>(chats: T[], taskId: string): T[] {
  return taskId ? chats.filter((c) => c.taskId === taskId) : [];
}

/**
 * The messages of `chat`, oldest first, the way a chat window reads them.
 * Empty for a chat `memberId` is not in, and any message from another chat
 * is dropped. A failed read throws.
 */
export async function listChatMessages(store: ChatStore, memberId: string, chat: Chat): Promise<ChatMessage[]> {
  if (!memberId) throw new CoreError('You are signed out, so there are no messages to show.');
  if (!isInChat(chat, memberId)) return [];
  const rows = await store.messages(chat.id);
  return rows
    .filter((m) => m.chatId === chat.id)
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
}

/**
 * Unread messages (WC-176: "Members cannot tell when a chat message is
 * waiting: show unread count"). A message is unread for `memberId` when it
 * is newer than when they last read the chat (`lastReadAt`, null: never) and
 * they did not send it: your own messages never count. The database repeats
 * this rule (`my_chat_unread`, supabase/migrations/20261113150000_chat_unread.sql).
 */
export function isUnreadChatMessage(
  message: Pick<ChatMessage, 'senderId' | 'sentAt'>,
  lastReadAt: string | null,
  memberId: string,
): boolean {
  if (!memberId || message.senderId === memberId) return false;
  if (lastReadAt === null) return true;
  return Date.parse(message.sentAt) > Date.parse(lastReadAt);
}

/** How many of `messages` are unread for `memberId`, by the rule above. */
export function countUnread(
  messages: Pick<ChatMessage, 'senderId' | 'sentAt'>[],
  lastReadAt: string | null,
  memberId: string,
): number {
  return messages.filter((m) => isUnreadChatMessage(m, lastReadAt, memberId)).length;
}

/**
 * What a count of unread chats or messages shows as: nothing at 0, the
 * number up to 9, and "9+" above that.
 */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count > 9 ? '9+' : String(Math.floor(count));
}

/** What core needs from storage for unread messages, acting as the signed-in member. Each throws if the database refuses or fails. */
export interface ChatReadStore {
  /** Mark chat `chatId` read for the signed-in member only, now. Hands back when. Throws if they are not in it. */
  markRead(chatId: string): Promise<{ readAt: string }>;
  /** For the signed-in member, each chat with unread messages and how many. */
  unread(): Promise<{ chatId: string; unread: number }[]>;
}

/**
 * `memberId` has read chat `chatId` up to now. Marks it for them alone; a
 * member not in the chat is refused by the store. Not a scored action: it is
 * not an engagement a member chooses. A failed save throws.
 */
export async function markChatRead(store: ChatReadStore, input: { memberId: string; chatId: string }): Promise<{ readAt: string }> {
  if (!input.memberId) throw new CoreError('You are signed out, so the chat was not marked read.');
  if (!input.chatId) throw new CoreError('You are not in that chat, so it was not marked read.');
  const saved = await store.markRead(input.chatId);
  if (!saved?.readAt) throw new CoreError('The chat was not marked read. Try again.');
  return { readAt: saved.readAt };
}

/**
 * The signed-in member's chats with unread messages, chat id to count.
 * Chats with none are left out. A failed read throws: it is never shown as
 * "nothing unread".
 */
export async function unreadChats(store: ChatReadStore, memberId: string): Promise<Map<string, number>> {
  if (!memberId) throw new CoreError('You are signed out, so there are no unread chats to show.');
  const rows = await store.unread();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = Math.floor(Number(r.unread));
    if (r.chatId && n > 0) counts.set(r.chatId, n);
  }
  return counts;
}
