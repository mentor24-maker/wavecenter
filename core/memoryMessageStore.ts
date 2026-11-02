/**
 * Messages kept in memory, for core's tests. Like the database's
 * `send_message` and `record_message_email`, it saves the message with its
 * tool, from the signed-in member, and records the email result once; the
 * rules about who may send are core's, so this store does not repeat them.
 * Like the messages table's row-level security, `list` hands back only the
 * messages the member sent or received. Like the database's
 * `message_recipient_email`, `recipientEmail` answers only for a pending
 * message the named sender sent; `save` never hands back an address.
 * Given an engagement store, it scores each message to another member for
 * its sender, as the database's `messages_score` does: if the engagement
 * cannot be written, the message is not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { EmailStatus, MessageAddressBook, MessageStore, SavedMessage } from './messages.ts';

export interface MemoryMessage {
  id: string;
  senderId: string;
  recipientId: string;
  subject: string;
  body: string;
  tool: string;
  emailStatus: EmailStatus;
  sentAt: string;
}

export class MemoryMessageStore implements MessageStore {
  readonly rows: MemoryMessage[] = [];
  /** Each member's email address. */
  readonly emails = new Map<string, string>();
  /** Who is signed in: the sender of every message saved, as the database's session decides. */
  signedIn = 'dane';
  /** Set to make the next read fail the way a refused read does. */
  failNextList = false;
  /** Set to hand back every message, whoever it belongs to: a store that reads too much. */
  leaky = false;
  /** Set to make the next save fail the way a refused write does. */
  failNextSave = false;
  /** Set to make the next address lookup fail. */
  failNextLookup = false;
  /** Set to make the next email result fail to record. */
  failNextRecord = false;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null) {
    this.engagements = engagements;
  }

  async save(message: { recipientId: string; subject: string; body: string }, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('The database refused to save the message.');
    }
    if (this.engagements && message.recipientId !== this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'send_a_message_to_another_member', tool });
    }
    const id = `message-${this.rows.length + 1}`;
    const sentAt = new Date(Date.UTC(2026, 10, 1, 0, this.rows.length)).toISOString();
    this.rows.push({ id, senderId: this.signedIn, ...message, tool, emailStatus: 'pending', sentAt });
    return { id };
  }

  /** The address book over these rows: the server's, never the member's session. */
  readonly addresses: MessageAddressBook = {
    recipientEmail: async (messageId, senderId) => {
      if (this.failNextLookup) {
        this.failNextLookup = false;
        throw new Error('The address lookup failed.');
      }
      const row = this.rows.find((r) => r.id === messageId && r.senderId === senderId && r.emailStatus === 'pending');
      return row ? this.emails.get(row.recipientId) ?? null : null;
    },
  };

  async recordEmail(messageId: string, status: 'sent' | 'failed') {
    if (this.failNextRecord) {
      this.failNextRecord = false;
      return null;
    }
    const row = this.rows.find((r) => r.id === messageId && r.emailStatus === 'pending');
    if (!row) return null;
    row.emailStatus = status;
    return status;
  }

  async list(memberId: string): Promise<SavedMessage[]> {
    if (this.failNextList) {
      this.failNextList = false;
      throw new Error('The database refused to read the messages.');
    }
    return this.rows
      .filter((r) => this.leaky || r.senderId === memberId || r.recipientId === memberId)
      .map(({ id, senderId, recipientId, subject, body, sentAt }) => ({ id, senderId, recipientId, subject, body, sentAt }));
  }
}
