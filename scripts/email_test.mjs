#!/usr/bin/env node
/**
 * `npm run email:test -- --to <address>`: send one test email through Resend
 * and say plainly whether it went. Doppler (`wavecenter`, `dev`) supplies
 * RESEND_API_KEY; the key is never printed. Prints `sent` and Resend's id and
 * exits 0, or one sentence saying why not and exits 1.
 * The guide this checks: docs/EMAIL_SETUP.md.
 */
import { parseTo, sendTestEmail } from './lib/emailTest.mjs';
import { DEFAULT_FROM, DEFAULT_REPLY_TO } from '../app/lib/mailer.ts';

const { to, error } = parseTo(process.argv.slice(2));
if (error) {
  console.error(`email:test: ${error}`);
  process.exit(1);
}

const from = process.env.MESSAGE_FROM || DEFAULT_FROM;
const result = await sendTestEmail({
  key: process.env.RESEND_API_KEY,
  to,
  from,
  replyTo: process.env.MESSAGE_REPLY_TO || DEFAULT_REPLY_TO,
});

if (result.ok) {
  console.log(`sent: Resend accepted the test email from ${from} to ${to} (id ${result.id}). It should arrive within a minute.`);
  process.exit(0);
}
console.error(`email:test: not sent. ${result.reason}`);
process.exit(1);
