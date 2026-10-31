/**
 * Messages kept in memory, for core's tests. Like the database's
 * `send_message` and `record_message_email`, it saves the message with its
 * tool and records the email result once; the rules about who may send are
 * core's, so this store does not repeat them.
 */
import type { EmailStatus, MessageStore } from './messages.ts';

export interface MemoryMessage {
  id: string;
  recipientId: string;
  subject: string;
  body: string;
  tool: string;
  emailStatus: EmailStatus;
}

export class MemoryMessageStore implements MessageStore {
  readonly rows: MemoryMessage[] = [];
  /** Each member's email address. */
  readonly emails = new Map<string, string>();
  /** Set to make the next save fail the way a refused write does. */
  failNextSave = false;
  /** Set to make the next email result fail to record. */
  failNextRecord = false;

  async save(message: { recipientId: string; subject: string; body: string }, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('The database refused to save the message.');
    }
    const id = `message-${this.rows.length + 1}`;
    this.rows.push({ id, ...message, tool, emailStatus: 'pending' });
    return { id, recipientEmail: this.emails.get(message.recipientId) ?? null };
  }

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
}
