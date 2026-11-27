// Guards WaveCenter's three account emails (WC-257): confirm your email,
// confirm a new address, reset your password. Each is pasted by hand into the
// live Supabase project (docs/EMAIL_SETUP.md, step 5), so a broken file here
// would reach members as a broken email. These checks catch the mistakes that
// are easy to make in hand-written email HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const TEMPLATES = {
  confirmation: { subject: 'Confirm your WaveCenter email', button: 'Confirm your email' },
  email_change: { subject: 'Confirm your new WaveCenter email address', button: 'Confirm the change' },
  recovery: { subject: 'Reset your WaveCenter password', button: 'Set a new password' },
};

for (const [kind, want] of Object.entries(TEMPLATES)) {
  const html = read(`supabase/templates/${kind}.html`);

  test(`${kind}: button and plain fallback link both carry Supabase's link`, () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ['{{ .ConfirmationURL }}', '{{ .ConfirmationURL }}']);
    assert.match(html, new RegExp(`>${want.button}</a>`));
    assert.match(html, />\{\{ \.ConfirmationURL \}\}<\/a>/, 'the link is also written out as text');
  });

  test(`${kind}: water-drop background with a dark-blue fallback`, () => {
    assert.match(html, /background="https:\/\/app\.wavecenter\.com\/brand\/home-background\.jpg"/);
    assert.match(html, /background-image:url\('https:\/\/app\.wavecenter\.com\/brand\/home-background\.jpg'\)/);
    assert.match(html, /bgcolor="#2c4a63"/);
  });

  test(`${kind}: logo and name at the top`, () => {
    assert.match(html, /<img src="https:\/\/app\.wavecenter\.com\/brand\/mark\.png"/);
    assert.match(html, /\n\s*WaveCenter\n/);
  });

  test(`${kind}: pod is 75% white, solid white first for programs without transparency`, () => {
    assert.match(html, /bgcolor="#ffffff" style="background-color:#ffffff; background-color:rgba\(255,255,255,0\.75\);/);
  });

  test(`${kind}: every picture and link is a full address (no site-relative paths)`, () => {
    for (const [, url] of html.matchAll(/(?:src|background)="([^"]*)"/g)) {
      assert.match(url, /^https:\/\/app\.wavecenter\.com\//, url);
    }
    assert.doesNotMatch(html, /url\('\//);
  });

  test(`${kind}: wired in config.toml with its WaveCenter subject`, () => {
    const toml = read('supabase/config.toml');
    const block = new RegExp(
      `\\[auth\\.email\\.template\\.${kind}\\]\\nsubject = "${want.subject}"\\ncontent_path = "\\./supabase/templates/${kind}\\.html"`,
    );
    assert.match(toml, block);
  });
}

test('email_change names both addresses, since Supabase sends it to the old and the new one', () => {
  const html = read('supabase/templates/email_change.html');
  assert.match(html, /\{\{ \.Email \}\}/);
  assert.match(html, /\{\{ \.NewEmail \}\}/);
});

test('local mail viewer sends as WaveCenter Admin, as the live project does', () => {
  const toml = read('supabase/config.toml');
  assert.match(toml, /\[local_smtp\][^[]*\nadmin_email = "noreply@wavecenter\.com"\nsender_name = "WaveCenter Admin"\n/);
});
