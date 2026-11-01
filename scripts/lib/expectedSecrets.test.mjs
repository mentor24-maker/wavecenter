import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_SECRETS, CONFIGS, doctorReport, formatReport } from './expectedSecrets.mjs';

const all = (config) => new Set(EXPECTED_SECRETS.filter((s) => s.configs.includes(config)).map((s) => s.name));

test('every expected name is in at least one known config, and names are unique', () => {
  const names = EXPECTED_SECRETS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  for (const s of EXPECTED_SECRETS) {
    assert.ok(s.configs.length > 0, s.name);
    for (const c of s.configs) assert.ok(CONFIGS.includes(c), `${s.name}: ${c}`);
  }
});

test('all present: ok, and a name not needed in a config is not a failure', () => {
  const report = doctorReport({ dev: all('dev'), prd: all('prd') });
  assert.equal(report.ok, true);
  const clickup = report.rows.find((r) => r.name === 'CLICKUP_API_TOKEN');
  assert.deepEqual(clickup.cells, { dev: 'present', prd: 'not needed' });
});

test('one missing name fails the whole report', () => {
  const prd = all('prd');
  prd.delete('DATABASE_URL');
  const report = doctorReport({ dev: all('dev'), prd });
  assert.equal(report.ok, false);
  assert.equal(report.rows.find((r) => r.name === 'DATABASE_URL').cells.prd, 'MISSING');
});

test('a config that could not be read is a failure, never a pass', () => {
  const report = doctorReport({ dev: all('dev'), prd: null });
  assert.equal(report.ok, false);
  assert.equal(report.rows.find((r) => r.name === 'SUPABASE_URL').cells.prd, 'unreadable');
});

test('the table has a header and one line per expected name', () => {
  const text = formatReport(doctorReport({ dev: all('dev'), prd: all('prd') }));
  const lines = text.split('\n');
  assert.equal(lines.length, EXPECTED_SECRETS.length + 1);
  assert.match(lines[0], /^NAME\s+dev\s+prd$/);
  assert.match(text, /CLICKUP_API_TOKEN\s+present\s+not needed/);
  assert.match(text, /RESEND_API_KEY\s+present\s+present/);
});
