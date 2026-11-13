/**
 * Chats kept in memory, for core's tests. It behaves as the database does
 * (supabase/migrations/20261112120000_chats.sql):
 *
 * - `start` is `start_chat`: it refuses an unknown member, yourself and a
 *   task that does not exist, and finds the chat already there for the pair
 *   and task, whichever of the two starts it.
 * - `send` is `send_chat_message`: it refuses a member who is not in the
 *   chat and an empty or over-long message, and, given an engagement store,
 *   scores the message for its sender as `chat_messages_score` does. If the
 *   engagement cannot be written, the message is not saved either.
 * - `chats` and `messages` read as row-level security lets the signed-in
 *   member read: only chats they are in.
 * - `markRead` is `mark_chat_read`: it sets when the signed-in member last
 *   read a chat, for them alone, and refuses a member not in it. `unread` is
 *   `my_chat_unread`: their chats with unread messages, by core's rule.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import { chatMessageProblem, countUnread, isInChat, startChatProblem, type Chat, type ChatMessage, type ChatReadStore, type ChatStore } from './chat.ts';
import { CoreError } from './tool.ts';

export class MemoryChatStore implements ChatStore, ChatReadStore {
  readonly chatRows: Chat[] = [];
  readonly messageRows: ChatMessage[] = [];
  /** Every member there is. */
  readonly members = new Set<string>(['dane', 'kim', 'lee']);
  /** Every task there is (every member reads every task). */
  readonly tasks = new Set<string>(['task-1']);
  /** Who is signed in, as the database's session decides. */
  signedIn = 'dane';
  /** Set to hand back every chat and message, whoever's: a store that reads too much. */
  leaky = false;
  /** Set to make the next send fail the way a refused write does. */
  failNextSend = false;
  /** When each member last read each chat, keyed `<chat id> <member id>`. Absent: never. */
  readonly lastRead = new Map<string, string>();
  private readonly engagements: EngagementStore | null;
  private clock = 0;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

  private now(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 10, 12, 0, 0, this.clock)).toISOString();
  }

  async start(otherMemberId: string, taskId: string | null) {
    if (!this.members.has(otherMemberId)) throw new CoreError('There is no such member.');
    const problem = startChatProblem(this.signedIn, otherMemberId);
    if (problem) throw new CoreError(problem);
    if (taskId !== null && !this.tasks.has(taskId)) throw new CoreError('There is no task of that id you may read, so no chat was started.');
    const pair = [this.signedIn, otherMemberId].sort().join(' ');
    const found = this.chatRows.find((c) => c.taskId === taskId && [...c.memberIds].sort().join(' ') === pair);
    if (found) return { id: found.id };
    const chat: Chat = { id: `chat-${this.chatRows.length + 1}`, taskId, memberIds: [this.signedIn, otherMemberId], createdBy: this.signedIn, createdAt: this.now() };
    this.chatRows.push(chat);
    return { id: chat.id };
  }

  async send(chatId: string, body: string, tool: string) {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('The database refused to save the chat message.');
    }
    const chat = this.chatRows.find((c) => c.id === chatId);
    if (!chat || !isInChat(chat, this.signedIn)) throw new CoreError('You are not in that chat, so no message was sent.');
    const problem = chatMessageProblem(body);
    if (problem) throw new CoreError(problem);
    if (this.engagements) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'sent_a_chat_message', tool });
    }
    const message: ChatMessage = { id: `chat-message-${this.messageRows.length + 1}`, chatId, senderId: this.signedIn, body: body.trim(), tool, sentAt: this.now() };
    this.messageRows.push(message);
    return { id: message.id };
  }

  async chats(memberId: string) {
    return this.chatRows.filter((c) => this.leaky || isInChat(c, memberId)).map((c) => ({ ...c, memberIds: [...c.memberIds] }));
  }

  async messages(chatId: string) {
    const chat = this.chatRows.find((c) => c.id === chatId);
    return this.messageRows
      .filter((m) => this.leaky || (chat && isInChat(chat, this.signedIn) && m.chatId === chatId))
      .map((m) => ({ ...m }));
  }

  async markRead(chatId: string) {
    const chat = this.chatRows.find((c) => c.id === chatId);
    if (!chat || !isInChat(chat, this.signedIn)) throw new CoreError('You are not in that chat, so it was not marked read.');
    const readAt = this.now();
    this.lastRead.set(`${chatId} ${this.signedIn}`, readAt);
    return { readAt };
  }

  async unread() {
    return this.chatRows
      .filter((c) => isInChat(c, this.signedIn))
      .map((c) => ({
        chatId: c.id,
        unread: countUnread(this.messageRows.filter((m) => m.chatId === c.id), this.lastRead.get(`${c.id} ${this.signedIn}`) ?? null, this.signedIn),
      }))
      .filter((r) => r.unread > 0);
  }
}
