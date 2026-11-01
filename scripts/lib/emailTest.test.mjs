import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTo, sendTestEmail } from './emailTest.mjs';

const KEY = 'test-key-not-real';
const base = { key: KEY, to: 'a@example.com', from: 'WaveCenter <noreply@wavecenter.com>', replyTo: 'b@example.com' };
const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

test('parseTo: takes the address after --to, and says plainly when it is missing or wrong', () => {
  assert.deepEqual(parseTo(['--to', 'a@example.com']), { to: 'a@example.com' });
  assert.match(parseTo([]).error, /--to/);
  assert.match(parseTo(['--to']).error, /--to/);
  assert.match(parseTo(['--to', 'nope']).error, /does not look like an email address/);
});

test('no key: a plain sentence naming RESEND_API_KEY, and nothing is sent', async () => {
  let called = false;
  const r = await sendTestEmail({ ...base, key: '', fetchImpl: async () => { called = true; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /RESEND_API_KEY is missing/);
  assert.equal(called, false);
});

test('accepted: returns Resend\'s id, and the request carries the from and reply-to', async () => {
  let sent;
  const r = await sendTestEmail({ ...base, fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return reply(200, { id: 'abc123' })(); } });
  assert.deepEqual(r, { ok: true, id: 'abc123' });
  assert.equal(sent.from, base.from);
  assert.deepEqual(sent.to, ['a@example.com']);
  assert.equal(sent.reply_to, 'b@example.com');
});

test('refused: a failure with Resend\'s reason, never a success (rule 6), and never the key', async () => {
  const r = await sendTestEmail({ ...base, fetchImpl: reply(403, { message: `The wavecenter.com domain is not verified ${KEY}` }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 403.*not verified/);
  assert.ok(!r.reason.includes(KEY));
});

test('unreachable, or an answer with no id, is a failure', async () => {
  const down = await sendTestEmail({ ...base, fetchImpl: async () => { throw new Error('offline'); } });
  assert.match(down.reason, /could not be reached/);
  const noId = await sendTestEmail({ ...base, fetchImpl: reply(200, {}) });
  assert.equal(noId.ok, false);
});
