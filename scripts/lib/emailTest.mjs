/**
 * The logic behind `npm run email:test`: one test email through Resend's
 * plain HTTPS API, the same call `app/lib/mailer.ts` makes, reported in plain
 * words. A refused send is a failure with Resend's own reason (engineering
 * rule 6). The key is passed in and never appears in any message.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** The address after `--to`, or an error sentence. */
export function parseTo(argv) {
  const i = argv.indexOf('--to');
  const to = i >= 0 ? argv[i + 1] : undefined;
  if (!to || to.startsWith('--')) return { error: 'Say who to send it to: npm run email:test -- --to you@example.com' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: `"${to}" does not look like an email address.` };
  return { to };
}

/**
 * Send one test email. Returns { ok: true, id } when Resend accepted it, or
 * { ok: false, reason } with a plain sentence when it did not.
 */
export async function sendTestEmail({ key, to, from, replyTo, fetchImpl = fetch }) {
  if (!key) {
    return { ok: false, reason: 'RESEND_API_KEY is missing from Doppler (wavecenter, dev), so no email can be sent. Add it as docs/EMAIL_SETUP.md step 3 says.' };
  }
  let res;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject: 'WaveCenter test email',
        text: 'This is a test email from WaveCenter (npm run email:test). If you can read it, email is working.',
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, reason: 'Resend could not be reached. Check the internet connection and try again.' };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const why = (body && body.message) || 'no reason given';
    return { ok: false, reason: `Resend refused the email (HTTP ${res.status}): ${redact(why, key)}` };
  }
  if (!body || !body.id) return { ok: false, reason: 'Resend answered without an email id, so it is not certain the email was sent.' };
  return { ok: true, id: body.id };
}

/** Belt and braces: never echo the key, even if a reply quotes it. */
function redact(text, key) {
  return key ? String(text).split(key).join('[key hidden]') : String(text);
}
