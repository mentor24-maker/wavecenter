import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODY_MAX, SUBJECT_MAX, messageProblem, sendMessage, type Mailer } from './messages.ts';
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
  return { stores: { roles, messages }, messages, mailer, sent };
}

const hello = { senderId: 'dane', recipientId: 'kim', subject: ' Test ', body: ' Hello ' };

test('an admin sends a message: it is saved with its tool, emailed, and marked sent', async () => {
  const { stores, messages, mailer, sent } = setup();
  const outcome = await sendMessage(stores, mailer, hello, TOOL);
  assert.deepEqual(outcome, { id: 'message-1', emailed: true, recorded: true });
  assert.deepEqual(messages.rows, [{ id: 'message-1', recipientId: 'kim', subject: 'Test', body: 'Hello', tool: TOOL, emailStatus: 'sent' }]);
  assert.deepEqual(sent, [{ to: 'kim@example.com', subject: 'Test', text: 'Hello' }]);
});

test('the email address goes to the mailer, never back to the caller', async () => {
  const { stores, mailer } = setup();
  const outcome = await sendMessage(stores, mailer, hello, TOOL);
  assert.equal(JSON.stringify(outcome).includes('@'), false);
});

test('only a role with Message members may send; nothing is saved or emailed otherwise', async () => {
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer'] as const) {
    const { stores, messages, mailer, sent } = setup();
    stores.roles.rows.set('sam', { role, tool: 'migration' });
    await assert.rejects(sendMessage(stores, mailer, { ...hello, senderId: 'sam' }, TOOL), /may not message/, role);
    assert.equal(messages.rows.length, 0);
    assert.equal(sent.length, 0);
  }
  const { stores, mailer } = setup();
  await assert.rejects(sendMessage(stores, mailer, { ...hello, senderId: 'nobody-recorded' }, TOOL), /may not message/);
});

test('the grants the database holds decide who may send', async () => {
  const { stores, mailer } = setup();
  stores.roles.rows.set('sam', { role: 'editor', tool: 'migration' });
  const outcome = await sendMessage(stores, mailer, { ...hello, senderId: 'sam', grants: { editor: ['member.message'] } }, TOOL);
  assert.equal(outcome.emailed, true);
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

test('a recipient with no email address is saved and not emailed', async () => {
  const { stores, mailer, sent } = setup();
  const outcome = await sendMessage(stores, mailer, { ...hello, recipientId: 'no-address' }, TOOL);
  assert.equal(outcome.emailed, false);
  assert.match(outcome.emailed ? '' : outcome.reason, /no email address/);
  assert.equal(sent.length, 0);
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
});
