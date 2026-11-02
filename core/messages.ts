/**
 * Messages from one member to another (Dane, 2026-10-30: "Sending the message
 * will email the message to the user and also store it in a messages table on
 * WaveCenter for access within the app"). A message is saved first, then
 * emailed; the email's result is recorded on the saved message.
 *
 * Who may send is a permission, `member.message` (every role since Dane's
 * "B" on 2026-11-01, when Your profile gained a Messaging section;
 * core/members.ts). The database's `send_message` repeats every rule here, so
 * a client that skips core is refused too. A member reads the messages they
 * sent or received (`listMessages`); the database's row-level security lets
 * nobody else read them.
 *
 * Like roles (core/members.ts), messages are reached through a store a client
 * supplies, and the email through a mailer a client supplies; every message
 * names its tool. The recipient's email address comes from an address book
 * the client supplies (the server's, outside the member's session) and goes
 * straight to the mailer: core never hands it to the caller.
 */
import { mayDo, roleOf, STARTING_ROLE_PERMISSIONS, type MemberRoleStore } from './members.ts';
import { CoreError, requireTool } from './tool.ts';

/**
 * What the Members page tells a member its envelope does. Every member's
 * message is emailed as well as saved (the server looks the address up
 * itself, never through the member's session).
 */
export const MESSAGE_ENVELOPE_NOTE =
  'The envelope writes to a member: the message is saved in WaveCenter and emailed to them.';

/** The longest subject and message the database takes. */
export const SUBJECT_MAX = 200;
export const BODY_MAX = 10000;

export type EmailStatus = 'pending' | 'sent' | 'failed';

/** What core needs from storage for messages. */
export interface MessageStore {
  /** Save the message from the signed-in member. Returns its id; never an email address. Throws if the save is refused. */
  save(message: { recipientId: string; subject: string; body: string }, tool: string): Promise<{ id: string }>;
  /** Record how the email went. Returns the status now recorded. */
  recordEmail(messageId: string, status: 'sent' | 'failed'): Promise<string | null>;
  /** Every message `memberId` sent or received, in any order. Throws if the read is refused. */
  list(memberId: string): Promise<SavedMessage[]>;
}

/** A saved message, as the sender and the recipient read it. Never carries an email address. */
export interface SavedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  subject: string;
  body: string;
  /** When it was saved, as an ISO date. */
  sentAt: string;
}

/**
 * The messages `memberId` sent or received, newest first. Anything the store
 * hands back that the member neither sent nor received is dropped, so a store
 * that reads too much still shows nobody else's mail. A failed read throws.
 */
export async function listMessages(store: MessageStore, memberId: string): Promise<SavedMessage[]> {
  if (!memberId) throw new CoreError('You are signed out, so there are no messages to show.');
  const rows = await store.list(memberId);
  return rows
    .filter((m) => m.senderId === memberId || m.recipientId === memberId)
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
}

/**
 * Where the recipient's email address comes from: never the member's own
 * session, so no member can collect another's address. It answers only for a
 * saved message `senderId` sent that is not yet emailed. Null when the
 * recipient has no address; throws if the lookup fails.
 */
export interface MessageAddressBook {
  recipientEmail(messageId: string, senderId: string): Promise<string | null>;
}

/** What core needs to send an email. Throws, in words a person can read, if the email did not go. */
export interface Mailer {
  send(email: { to: string; subject: string; text: string }): Promise<void>;
}

/**
 * What happened. The message is saved in every case; `emailed` says whether
 * the email went too. `recorded` says whether the saved message's email
 * status is what it should be (`sent` or `failed`).
 */
export type MessageOutcome =
  | { id: string; emailed: true; recorded: boolean }
  | { id: string; emailed: false; reason: string; recorded: boolean };

/** Why a message cannot be sent, in plain words, or null if it can. Nothing is saved for a refused message. */
export function messageProblem(subject: string, body: string): string | null {
  if (subject.trim() === '') return 'A message needs a subject.';
  if (body.trim() === '') return 'A message needs some text.';
  if (subject.trim().length > SUBJECT_MAX) return `The subject is too long: keep it to ${SUBJECT_MAX} characters or fewer.`;
  if (body.trim().length > BODY_MAX) return `The message is too long: keep it to ${BODY_MAX} characters or fewer.`;
  return null;
}

/**
 * `senderId` sends `recipientId` a message, on behalf of `tool`, and emails
 * it through `mailer` (null when this copy of WaveCenter has no email set
 * up), to the address `stores.addresses` finds (null when this copy cannot
 * look addresses up). Throws a CoreError, with nothing saved, if the sender may not message
 * or the subject or text is empty. A failed save throws too. Once the message
 * is saved, a failed email is reported as such, never as sent.
 */
export async function sendMessage(
  stores: { roles: MemberRoleStore; messages: MessageStore; addresses: MessageAddressBook | null },
  mailer: Mailer | null,
  message: {
    senderId: string;
    recipientId: string;
    subject: string;
    body: string;
    grants?: Readonly<Record<string, readonly string[]>>;
  },
  tool: string,
): Promise<MessageOutcome> {
  const named = requireTool(tool);
  const role = await roleOf(stores.roles, message.senderId);
  if (!mayDo(role, 'member.message', message.grants ?? STARTING_ROLE_PERMISSIONS)) {
    throw new CoreError('Your role may not message members.');
  }
  const problem = messageProblem(message.subject, message.body);
  if (problem) throw new CoreError(problem);
  const subject = message.subject.trim();
  const body = message.body.trim();

  const saved = await stores.messages.save({ recipientId: message.recipientId, subject, body }, named);
  if (!saved?.id) throw new CoreError('The message did not save. Nothing was sent; try again.');

  let outcome: { emailed: true } | { emailed: false; reason: string };
  if (!mailer) {
    outcome = { emailed: false, reason: 'WaveCenter has no email service set up yet.' };
  } else if (!stores.addresses) {
    outcome = { emailed: false, reason: 'WaveCenter cannot look up members’ email addresses yet.' };
  } else {
    let to: string | null = null;
    let lookedUp = true;
    try {
      to = await stores.addresses.recipientEmail(saved.id, message.senderId);
    } catch {
      lookedUp = false;
    }
    if (!lookedUp) {
      outcome = { emailed: false, reason: 'WaveCenter could not look up the recipient’s email address.' };
    } else if (!to) {
      outcome = { emailed: false, reason: 'This member has no email address on file.' };
    } else {
      try {
        await mailer.send({ to, subject, text: body });
        outcome = { emailed: true };
      } catch (err) {
        outcome = { emailed: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  const status = outcome.emailed ? 'sent' : 'failed';
  let recorded = false;
  try {
    recorded = (await stores.messages.recordEmail(saved.id, status)) === status;
  } catch {
    recorded = false;
  }
  return { id: saved.id, ...outcome, recorded };
}
