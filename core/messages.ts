/**
 * Messages from one member to another (Dane, 2026-10-30: "Sending the message
 * will email the message to the user and also store it in a messages table on
 * WaveCenter for access within the app"). A message is saved first, then
 * emailed; the email's result is recorded on the saved message.
 *
 * Who may send is a permission, `member.message` (admins only to start;
 * core/members.ts). The database's `send_message` repeats every rule here, so
 * a client that skips core is refused too.
 *
 * Like roles (core/members.ts), messages are reached through a store a client
 * supplies, and the email through a mailer a client supplies; every message
 * names its tool. The recipient's email address comes back from the store and
 * goes straight to the mailer: core never hands it to the caller.
 */
import { mayDo, roleOf, STARTING_ROLE_PERMISSIONS, type MemberRoleStore } from './members.ts';
import { CoreError, requireTool } from './tool.ts';

/** The longest subject and message the database takes. */
export const SUBJECT_MAX = 200;
export const BODY_MAX = 10000;

export type EmailStatus = 'pending' | 'sent' | 'failed';

/** What core needs from storage for messages. */
export interface MessageStore {
  /** Save the message from the signed-in member. Returns its id and the recipient's email address (null if they have none). Throws if the save is refused. */
  save(message: { recipientId: string; subject: string; body: string }, tool: string): Promise<{ id: string; recipientEmail: string | null }>;
  /** Record how the email went. Returns the status now recorded. */
  recordEmail(messageId: string, status: 'sent' | 'failed'): Promise<string | null>;
}

/** What core needs to send an email. Throws, in words a person can read, if the email did not go. */
export interface Mailer {
  send(email: { to: string; subject: string; text: string }): Promise<void>;
}

/** What happened. The message is saved in every case; `emailed` says whether the email went too. */
export type MessageOutcome =
  | { id: string; emailed: true; recorded: boolean }
  | { id: string; emailed: false; reason: string; recorded: boolean };

/** Why a message cannot be sent, in plain words, or null if it can. Nothing is saved for a refused message. */
export function messageProblem(subject: string, body: string): string | null {
  if (subject.trim() === '') return 'A message needs a subject.';
  if (body.trim() === '') return 'A message needs some text.';
  if (subject.trim().length > SUBJECT_MAX) return `The subject is too long: keep it under ${SUBJECT_MAX} characters.`;
  if (body.trim().length > BODY_MAX) return `The message is too long: keep it under ${BODY_MAX} characters.`;
  return null;
}

/**
 * `senderId` sends `recipientId` a message, on behalf of `tool`, and emails
 * it through `mailer` (null when this copy of WaveCenter has no email set
 * up). Throws a CoreError, with nothing saved, if the sender may not message
 * or the subject or text is empty. A failed save throws too. Once the message
 * is saved, a failed email is reported as such, never as sent.
 */
export async function sendMessage(
  stores: { roles: MemberRoleStore; messages: MessageStore },
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
  } else if (!saved.recipientEmail) {
    outcome = { emailed: false, reason: 'This member has no email address on file.' };
  } else {
    try {
      await mailer.send({ to: saved.recipientEmail, subject, text: body });
      outcome = { emailed: true };
    } catch (err) {
      outcome = { emailed: false, reason: err instanceof Error ? err.message : String(err) };
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
