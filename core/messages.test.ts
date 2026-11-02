import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ANONYMOUS_SENDER, BODY_MAX, messageEnvelopeNote, REPLY_URL, SUBJECT_MAX, listMessages, messageEmail, messageProblem, senderName, sendMessage, type Mailer } from './messages.ts';
import { CoreError } from './tool.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';
import { MemoryMessageStore } from './memoryMessageStore.ts';

const TOOL = 'wavecenter';

function setup() {
  const roles = new MemoryMemberRoleStore();
  roles.rows.set('dane', { role: 'admin', tool: 'migration' });
  const messages = new MemoryMessageStore();
  messages.emails.set('kim', 'kim@example.com');
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (email) => { sent.push(email); } };
  return { stores: { roles, messages, addresses: messages.addresses }, messages, mailer, sent };
}

const hello = { senderId: 'dane', recipientId: 'kim', subject: ' Test ', body: ' Hello ' };

test('an admin sends a message: it is saved with its tool, emailed, and marked sent', async () => {
  const { stores, messages, mailer, sent } = setup();
  const outcome = await sendMessage(stores, mailer, { ...hello, senderName: 'Dane' }, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: true, recorded: true });
  assert.deepEqual(messages.rows, [
    { id: 'message-1', senderId: 'dane', recipientId: 'kim', subject: 'Test', body: 'Hello', tool: TOOL, emailStatus: 'sent', sentAt: messages.rows[0].sentAt },
  ]);
  assert.deepEqual(sent, [{ to: 'kim@example.com', ...messageEmail('Dane', 'Test', 'Hello') }]);
});

test('the email address goes to the mailer, never back to the caller', async () => {
  const { stores, mailer } = setup();
  const outcome = await sendMessage(stores, mailer, hello, TOOL);
  assert.equal(JSON.stringify(outcome).includes('@'), false);
});

test('every role\'s message is saved, emailed and marked sent, not only an admin\'s', async () => {
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer'] as const) {
    const { stores, messages, mailer, sent } = setup();
    stores.roles.rows.set('sam', { role, tool: 'migration' });
    messages.signedIn = 'sam';
    const outcome = await sendMessage(stores, mailer, { ...hello, senderId: 'sam' }, TOOL);
    assert.deepEqual(outcome, { id: 'message-1', emailed: true, recorded: true }, role);
    assert.equal(messages.rows[0].senderId, 'sam');
    assert.equal(messages.rows[0].emailStatus, 'sent', role);
    assert.deepEqual(sent, [{ to: 'kim@example.com', ...messageEmail(ANONYMOUS_SENDER, 'Test', 'Hello') }], role);
  }
});

test('the email names its sender, and says replies are not read and where to answer instead', () => {
  const email = messageEmail('Kim Lee', 'Plans', 'See you Tuesday.');
  assert.equal(email.subject, 'Message from Kim Lee: Plans');
  assert.match(email.text, /^Kim Lee sent you this message through WaveCenter:\n\nSee you Tuesday\.\n\n--\n/);
  assert.match(email.text, /Replies to this email are not read, and Kim Lee does not see your email address\./);
  assert.ok(email.text.endsWith(`To answer, open Your profile in WaveCenter and use Send Message: ${REPLY_URL}`));
  assert.equal(email.text.includes('@'), false);
});

test('the email shows a sender\'s name only when their profile shows it to other members', () => {
  assert.equal(senderName({ displayName: ' Kim Lee ', visibility: 'public' }), 'Kim Lee');
  assert.equal(senderName({ displayName: 'Kim Lee', visibility: 'private' }), ANONYMOUS_SENDER);
  assert.equal(senderName({ displayName: 'Kim Lee', visibility: 'anonymous' }), ANONYMOUS_SENDER);
  assert.equal(senderName({ displayName: null, visibility: 'public' }), ANONYMOUS_SENDER);
  assert.equal(senderName({ displayName: '  ', visibility: 'public' }), ANONYMOUS_SENDER);
  assert.equal(senderName(null), ANONYMOUS_SENDER);
});

test('a message sent with no sender name is emailed as from an anonymous member', async () => {
  const { stores, mailer, sent } = setup();
  await sendMessage(stores, mailer, { ...hello, senderName: '  ' }, TOOL);
  assert.equal(sent[0].subject, `Message from ${ANONYMOUS_SENDER}: Test`);
});

test('the mailer sends no reply-to address, so a reply reaches nobody\'s inbox', () => {
  const mailer = readFileSync(new URL('../app/lib/mailer.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mailer, /reply_to|replyTo|gmail/i);
});

test('the store that saves a message never hands back an address; only the server\'s address book does', async () => {
  const { messages } = setup();
  const saved = await messages.save({ recipientId: 'kim', subject: 'Hi', body: 'Hello' }, TOOL);
  assert.deepEqual(saved, { id: 'message-1' });
  assert.equal(await messages.addresses.recipientEmail('message-1', 'someone-else'), null);
  assert.equal(await messages.addresses.recipientEmail('message-1', 'dane'), 'kim@example.com');
});

test('the database hands no address to a member\'s session, and only the service key looks one up', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261101150000_email_every_message.sql', import.meta.url), 'utf8');
  const send = sql.slice(sql.indexOf('create function public.send_message'), sql.indexOf('create or replace function public.message_recipient_email'));
  assert.match(send, /returns table \(id uuid\)/);
  assert.doesNotMatch(send, /\.email\b/);
  assert.match(sql, /revoke execute on function public\.message_recipient_email\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.message_recipient_email\(uuid, uuid\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute on function public\.message_recipient_email\(uuid, uuid\) to [^;]*authenticated/);
  const store = readFileSync(new URL('../app/lib/messageStore.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(store, /recipient_email/);
});

test('across every migration, the only function still reading an email address is the service-only lookup', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const latest = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    const parts = sql.split(/create (?:or replace )?function /i).slice(1);
    for (const part of parts) {
      const name = part.match(/^([\w.]+)\s*\(/)?.[1];
      const body = part.slice(0, part.search(/\$\$;/) + 3);
      if (name) latest.set(name, body);
    }
  }
  const reading = [...latest].filter(([, body]) => /\.email\b(?!_)/.test(body)).map(([name]) => name);
  assert.deepEqual(reading, ['public.message_recipient_email']);
});

test('the Members page promises an email only when email is set up', () => {
  assert.match(messageEnvelopeNote(true), /emailed to them/);
  assert.doesNotMatch(messageEnvelopeNote(false), /emailed to them/);
  assert.match(messageEnvelopeNote(false), /not emailed/);
  const page = readFileSync(new URL('../app/members/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /messageEnvelopeNote\(/);
  assert.doesNotMatch(page, /only an admin/);
});

test('a role without Message members may not send; nothing is saved or emailed', async () => {
  const { stores, messages, mailer, sent } = setup();
  stores.roles.rows.set('sam', { role: 'viewer', tool: 'migration' });
  await assert.rejects(sendMessage(stores, mailer, { ...hello, senderId: 'sam', grants: { viewer: ['task.read'] } }, TOOL), /may not message/);
  assert.equal(messages.rows.length, 0);
  assert.equal(sent.length, 0);
});

test('the grants the database holds decide who may send', async () => {
  const { stores, mailer } = setup();
  stores.roles.rows.set('sam', { role: 'editor', tool: 'migration' });
  stores.messages.signedIn = 'sam';
  const outcome = await sendMessage(stores, mailer, { ...hello, senderId: 'sam', grants: { editor: ['member.message'] } }, TOOL);
  assert.equal(outcome.id, 'message-1');
  await assert.rejects(sendMessage(stores, mailer, { ...hello, grants: { admin: ['member.read'] } }, TOOL), /may not message/);
});

test('an empty subject or message is refused in plain words, and nothing is saved', async () => {
  const { stores, messages, mailer, sent } = setup();
  await assert.rejects(sendMessage(stores, mailer, { ...hello, subject: '   ' }, TOOL), /needs a subject/);
  await assert.rejects(sendMessage(stores, mailer, { ...hello, body: '' }, TOOL), /needs some text/);
  assert.equal(messages.rows.length, 0);
  assert.equal(sent.length, 0);
});

test('messageProblem names what is wrong, or nothing', () => {
  assert.equal(messageProblem('Hi', 'Hello'), null);
  assert.match(messageProblem('', 'Hello') ?? '', /subject/);
  assert.match(messageProblem('Hi', '\n') ?? '', /text/);
  assert.match(messageProblem('x'.repeat(SUBJECT_MAX + 1), 'Hello') ?? '', /subject is too long/);
  assert.match(messageProblem('Hi', 'x'.repeat(BODY_MAX + 1)) ?? '', /message is too long/);
});

test('a message with no tool name is refused', async () => {
  const { stores, mailer } = setup();
  await assert.rejects(sendMessage(stores, mailer, hello, ' '), /name the tool/);
});

test('a failed save throws, so nothing is reported sent and no email goes', async () => {
  const { stores, messages, mailer, sent } = setup();
  messages.failNextSave = true;
  await assert.rejects(sendMessage(stores, mailer, hello, TOOL), /refused to save/);
  assert.equal(sent.length, 0);
});

test('a failed email is reported as not emailed, with the reason, and marked failed', async () => {
  const { stores, messages } = setup();
  const broken: Mailer = { send: async () => { throw new Error('The email service refused the email.'); } };
  const outcome = await sendMessage(stores, broken, hello, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: false, reason: 'The email service refused the email.', recorded: true });
  assert.equal(messages.rows[0].emailStatus, 'failed');
});

test('with no email service set up, the message is saved and says it was not emailed', async () => {
  const { stores, messages } = setup();
  const outcome = await sendMessage(stores, null, hello, TOOL);
  assert.equal(outcome.emailed, false);
  assert.match(outcome.emailed ? '' : outcome.reason, /no email service/);
  assert.equal(messages.rows[0].emailStatus, 'failed');
});

test('without an address book, the message is saved, not emailed, and says why', async () => {
  const { stores, messages, mailer, sent } = setup();
  const outcome = await sendMessage({ ...stores, addresses: null }, mailer, hello, TOOL);
  assert.equal(outcome.emailed, false);
  assert.match(outcome.emailed ? '' : outcome.reason, /cannot look up/);
  assert.equal(messages.rows[0].emailStatus, 'failed');
  assert.equal(sent.length, 0);
});

test('a failed address lookup is reported as not emailed, never as sent', async () => {
  const { stores, messages, mailer, sent } = setup();
  messages.failNextLookup = true;
  const outcome = await sendMessage(stores, mailer, hello, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: false, reason: 'WaveCenter could not look up the recipient’s email address.', recorded: true });
  assert.equal(messages.rows[0].emailStatus, 'failed');
  assert.equal(sent.length, 0);
});

test('a recipient with no email address is saved and not emailed, without guessing why', async () => {
  const { stores, mailer, sent } = setup();
  const outcome = await sendMessage(stores, mailer, { ...hello, recipientId: 'no-address' }, TOOL);
  assert.equal(outcome.emailed, false);
  assert.equal(outcome.emailed ? '' : outcome.reason, 'WaveCenter found no email address to send this message to.');
  assert.equal(sent.length, 0);
});

test('a lookup refused in plain words, like the hourly email limit, gives the sender those words', async () => {
  const { stores, messages, mailer, sent } = setup();
  const limited = { recipientEmail: async () => { throw new CoreError('You have sent 20 messages in the last hour, so this one was not emailed.'); } };
  const outcome = await sendMessage({ ...stores, addresses: limited }, mailer, hello, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: false, reason: 'You have sent 20 messages in the last hour, so this one was not emailed.', recorded: true });
  assert.equal(messages.rows[0].emailStatus, 'failed');
  assert.equal(sent.length, 0);
});

test('the database caps each member at 20 emailed messages an hour, counting every message saved, with a code the server reads', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261101150000_email_every_message.sql', import.meta.url), 'utf8');
  // Every message saved in the hour counts, whatever its email status: a
  // count of 'sent' rows alone lets a burst of sends all slip past.
  assert.match(sql, /m\.sender_id = sender and m\.id <> message and m\.created_at > now\(\) - interval '1 hour'\) >= 20/);
  assert.doesNotMatch(sql, /email_status = 'sent' and m\.emailed_at/);
  assert.match(sql, /errcode = 'WC429'/);
  const book = readFileSync(new URL('../app/lib/messageAddressBook.ts', import.meta.url), 'utf8');
  assert.match(book, /^import "server-only";$/m);
  assert.match(book, /refusal\?\.code === "WC429"/);
});

test('an email result that does not record still reports the email truthfully', async () => {
  const { stores, messages, mailer } = setup();
  messages.failNextRecord = true;
  const outcome = await sendMessage(stores, mailer, hello, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: true, recorded: false });
});

test('the migration turns on row-level security in the same file that makes the table', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261031150000_messages.sql', import.meta.url), 'utf8');
  const made = sql.indexOf('create table if not exists public.messages');
  const secured = sql.indexOf('alter table public.messages enable row level security');
  assert.ok(made >= 0 && secured > made);
  assert.match(sql, /\(\s*'admin',\s*'member\.message'\)/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/);
  // Only the sender and the recipient read a message.
  assert.match(sql, /for select to authenticated\s+using \(\(select auth\.uid\(\)\) = sender_id or \(select auth\.uid\(\)\) = recipient_id\)/);
});

/** Kim and Dane trade messages, and Lee writes to Kim: three messages, two for each of Dane's correspondents. */
async function threeMessages() {
  const s = setup();
  s.stores.roles.rows.set('kim', { role: 'viewer', tool: 'migration' });
  s.stores.roles.rows.set('lee', { role: 'viewer', tool: 'migration' });
  s.messages.emails.set('dane', 'dane@example.com');
  await sendMessage(s.stores, s.mailer, { ...hello, subject: 'First' }, TOOL);
  s.messages.signedIn = 'kim';
  await sendMessage(s.stores, s.mailer, { senderId: 'kim', recipientId: 'dane', subject: 'Reply', body: 'Hi Dane' }, TOOL);
  s.messages.signedIn = 'lee';
  await sendMessage(s.stores, s.mailer, { senderId: 'lee', recipientId: 'kim', subject: 'Private', body: 'Just for Kim' }, TOOL);
  return s;
}

test('a member reads the messages they sent and received, newest first, and no one else\'s', async () => {
  const { messages } = await threeMessages();
  const dane = await listMessages(messages, 'dane');
  assert.deepEqual(dane.map((m) => m.subject), ['Reply', 'First']);
  assert.deepEqual(dane.map((m) => [m.senderId, m.recipientId]), [['kim', 'dane'], ['dane', 'kim']]);
  assert.deepEqual((await listMessages(messages, 'kim')).map((m) => m.subject), ['Private', 'Reply', 'First']);
  assert.deepEqual((await listMessages(messages, 'lee')).map((m) => m.subject), ['Private']);
  assert.deepEqual(await listMessages(messages, 'stranger'), []);
});

test('a store that hands back too much still shows a member nobody else\'s messages', async () => {
  const { messages } = await threeMessages();
  messages.leaky = true;
  assert.deepEqual((await listMessages(messages, 'dane')).map((m) => m.subject), ['Reply', 'First']);
});

test('a read message carries no email address', async () => {
  const { messages } = await threeMessages();
  assert.equal(JSON.stringify(await listMessages(messages, 'kim')).includes('@'), false);
});

test('a failed read throws, so the screen can say it could not load them', async () => {
  const { messages } = await threeMessages();
  messages.failNextList = true;
  await assert.rejects(listMessages(messages, 'dane'), /refused to read/);
  await assert.rejects(listMessages(messages, ''), /signed out/);
});
