import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrationFiles, lastJson, pushList, missingOnRemote, scrub, cliError, isLocalUrl, databaseLine, applyMigrations, cliEnv,
  takeTestDbLock, releaseTestDbLock, preMergeStep,
} from './migrations.mjs';
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real output shapes, copied from supabase CLI 2.115.0 on the test database (2026-10-29).
const DRY_RUN = [
  'DRY RUN: migrations will *not* be pushed to the database.',
  'Connecting to remote database...',
  'Would push these migrations:',
  ' • 20261030000000_broken.sql',
  '{"upToDate":false,"dryRun":true,"migrations":["20261030000000_broken.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}',
].join('\n');
const PUSH_FAILED = [
  'Applying migration 20261030000000_broken.sql...',
  '{"_tag":"Error","error":{"code":"LegacyDbPushApplyError","message":"ERROR: column \\"x\\" does not exist (SQLSTATE 42703)"}}',
].join('\n');
const LIST = '{"migrations":[{"local":"20261029210000","remote":"20261029210000"},{"local":"20261030000000","remote":""}],"message":"Migrations listed"}';

// The same commands captured OUTSIDE a Claude session (no agent variables set),
// which is how the merge lane runs from launchd: supabase CLI 2.115.0 prints
// human text only. Captured on the test database on 2026-10-31; stdout first,
// then stderr, the way applyMigrations joins them.
const NUDGE = [
  'A new version of Supabase CLI is available: v2.122.0 (currently installed v2.115.0)',
  'We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli',
];
const HUMAN_DRY_RUN = [
  'Finished supabase db push.',
  '',
  'DRY RUN: migrations will *not* be pushed to the database.',
  'Connecting to remote database...',
  'Would push these migrations:',
  ' \u2022 20261031120000_evolution.sql',
  ...NUDGE,
].join('\n');
const HUMAN_DRY_RUN_TWO = [
  'Finished supabase db push.',
  '',
  'DRY RUN: migrations will *not* be pushed to the database.',
  'Connecting to remote database...',
  'Would push these migrations:',
  ' \u2022 29991231000000_scratch.sql',
  ' \u2022 29991231000001_scratch_two.sql',
  ...NUDGE,
].join('\n');
const HUMAN_UP_TO_DATE = [
  'Remote database is up to date.',
  '',
  'DRY RUN: migrations will *not* be pushed to the database.',
  'Connecting to remote database...',
  ...NUDGE,
].join('\n');
const HUMAN_PUSH_REFUSED = [
  '',
  'DRY RUN: migrations will *not* be pushed to the database.',
  'Connecting to remote database...',
  '\x1b[31mRemote migration versions not found in local migrations directory.\x1b[39m',
  '',
  'Make sure your local git repo is up-to-date. If the error persists, try repairing the migration history table:',
  'supabase migration repair --status reverted 20261031120000',
  '',
  ...NUDGE,
].join('\n');
const HUMAN_LIST = [
  '',
  '  ',
  '   Local            | Remote           | Time (UTC)            ',
  '  ------------------|------------------|-----------------------',
  '   `20261029210000` | `20261029210000` | `2026-10-29 21:00:00` ',
  '   ` `              | `20261031120000` | `2026-10-31 12:00:00` ',
  '   `29991231000000` | ` `              | `2999-12-31 00:00:00` ',
  '',
  '',
  'Connecting to remote database...',
  ...NUDGE,
].join('\n');

test('only .sql files directly in supabase/migrations count as migrations', () => {
  assert.deepEqual(migrationFiles([
    'supabase/migrations/20261030000000_b.sql',
    { path: 'supabase/migrations/20261029000000_a.sql' },
    'supabase/config.toml',
    'supabase/migrations/notes.md',
    'supabase/migrations/old/20261001000000_x.sql',
    'docs/supabase/migrations/20261001000000_y.sql',
  ]), ['20261029000000_a.sql', '20261030000000_b.sql']);
  assert.deepEqual(migrationFiles(undefined), []);
});

test('the CLI JSON line is found after the human lines', () => {
  assert.deepEqual(pushList(DRY_RUN), ['20261030000000_broken.sql']);
  assert.deepEqual(pushList('{"upToDate":true,"migrations":[]}'), []);
  assert.equal(pushList('Connecting...\nno json here'), null);
  assert.equal(lastJson('{not json\n{"a":1}', 'a').a, 1);
  assert.equal(lastJson('{\n  "API_URL": "http://127.0.0.1:54521"\n}\n', 'API_URL').API_URL, 'http://127.0.0.1:54521');
});

test('a migration counts as on the remote only when the remote column has it', () => {
  assert.deepEqual(missingOnRemote(LIST, ['20261029210000_x.sql', '20261030000000_broken.sql']), ['20261030000000_broken.sql']);
  assert.deepEqual(missingOnRemote(LIST, ['20261029210000_x.sql']), []);
  assert.equal(missingOnRemote('garbage', ['20261029210000_x.sql']), null);
});

test('outside a Claude session the CLI human text is read the same way', () => {
  assert.deepEqual(pushList(HUMAN_DRY_RUN), ['20261031120000_evolution.sql']);
  assert.deepEqual(pushList(HUMAN_DRY_RUN_TWO), ['29991231000000_scratch.sql', '29991231000001_scratch_two.sql']);
  assert.deepEqual(pushList(HUMAN_UP_TO_DATE), []);
  assert.equal(pushList(HUMAN_PUSH_REFUSED), null);
  assert.equal(pushList('Finished supabase db push.\nConnecting to remote database...'), null);
  // A heading with no file under it is not "nothing to push"; it is unreadable.
  assert.equal(pushList('Would push these migrations:\nFinished supabase db push.'), null);

  assert.deepEqual(missingOnRemote(HUMAN_LIST, ['20261029210000_x.sql', '20261031120000_evolution.sql', '29991231000000_scratch.sql']), ['29991231000000_scratch.sql']);
  assert.deepEqual(missingOnRemote(HUMAN_LIST, ['20261031120000_evolution.sql']), []);
  assert.equal(missingOnRemote('Connecting to remote database...', ['20261031120000_evolution.sql']), null);
});

test('the CLI never sees the agent variables, so a session and the lane get the same output', () => {
  const env = cliEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', AI_AGENT: 'x', CODEX_THREAD_ID: 't', GEMINI_CLI: '1', CURSOR_AGENT: '1', DATABASE_URL: 'd' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', DATABASE_URL: 'd' });
  const { run, ran } = fakeRun({ 'db push dry': { stdout: 'Remote database is up to date.' } });
  let seen;
  const spy = (cmd, args, opts) => { if (cmd === 'supabase') seen = opts.env; return run(cmd, args); };
  assert.deepEqual(applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run: spy }), { ok: true, applied: [] });
  assert.equal(ran.some((r) => r.includes('--yes')), false);
  assert.equal('CLAUDECODE' in seen, false);
});

test('a database address never reaches a note', () => {
  const leaked = 'failed to connect to postgresql://postgres.abc:hunter2@db.example.com:5432/postgres now';
  assert.equal(scrub(leaked).includes('hunter2'), false);
  assert.equal(cliError(leaked).includes('hunter2'), false);
  assert.match(cliError(PUSH_FAILED), /column "x" does not exist/);
});

test('db:test only ever talks to this machine', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:54521'), true);
  assert.equal(isLocalUrl('http://localhost:54521'), true);
  assert.equal(isLocalUrl('https://abcdefgh.supabase.co'), false);
  assert.equal(isLocalUrl('http://127.0.0.1.evil.example'), false);
  assert.equal(isLocalUrl(''), false);
});

test('the merge note says what happened to the database', () => {
  assert.match(databaseLine({ files: [] }), /no database change/);
  assert.match(databaseLine({ files: ['a.sql'], applied: [] }), /already on the live database/);
  assert.match(databaseLine({ files: ['a.sql'], applied: ['a.sql'] }), /applied a\.sql .*read it back/);
});

/** A fake git + supabase: answers by command, records what ran. */
function fakeRun(answers) {
  const ran = [];
  const run = (cmd, args) => {
    ran.push([cmd, ...args].join(' '));
    const key = cmd === 'supabase' ? `${args[0]} ${args[1]}${args.includes('--dry-run') ? ' dry' : ''}` : cmd;
    const a = answers[key] ?? { status: 0, stdout: '' };
    return { status: a.status ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return { run, ran };
}

test('apply: nothing pending applies nothing and is fine', () => {
  const { run, ran } = fakeRun({ 'db push dry': { stdout: '{"upToDate":true,"migrations":[]}' } });
  assert.deepEqual(applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run }), { ok: true, applied: [] });
  assert.equal(ran.some((r) => r.includes('--yes')), false);
});

test('apply: a pushed migration must read back from the database', () => {
  const pending = '{"migrations":["20261030000000_broken.sql"]}';
  const good = fakeRun({ 'db push dry': { stdout: pending }, 'migration list': { stdout: '{"migrations":[{"local":"20261030000000","remote":"20261030000000"}]}' } });
  assert.deepEqual(applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run: good.run }), { ok: true, applied: ['20261030000000_broken.sql'] });

  const notThere = fakeRun({ 'db push dry': { stdout: pending }, 'migration list': { stdout: LIST } });
  const r = applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run: notThere.run });
  assert.equal(r.ok, false);
  assert.match(r.error, /does not list 20261030000000_broken\.sql/);
});

test('apply: a failed push says what failed and never leaks the address', () => {
  const { run } = fakeRun({ 'db push dry': { stdout: '{"migrations":["20261030000000_broken.sql"]}' }, 'db push': { status: 1, stdout: PUSH_FAILED } });
  const r = applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:secretpw@h/db', run });
  assert.equal(r.ok, false);
  assert.match(r.error, /applying 20261030000000_broken\.sql failed: ERROR: column "x" does not exist/);
  assert.equal(r.error.includes('secretpw'), false);
});

test('apply: the human output end to end, as the merge lane sees it', () => {
  const { run } = fakeRun({ 'db push dry': { stdout: 'Finished supabase db push.\n', stderr: HUMAN_DRY_RUN }, 'migration list': { stdout: HUMAN_LIST } });
  assert.deepEqual(applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run }), { ok: true, applied: ['20261031120000_evolution.sql'] });

  const refused = fakeRun({ 'db push dry': { status: 1, stderr: HUMAN_PUSH_REFUSED } });
  const r = applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: 'postgresql://u:p@h/db', run: refused.run });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not say what it would apply: .*supabase migration repair/);
  assert.doesNotMatch(r.error, /new version/);
});

test('apply: no database address means no apply, said plainly', () => {
  const { run, ran } = fakeRun({});
  assert.match(applyMigrations({ repoDir: '.', commit: 'abc', dbUrl: '', run }).error, /DATABASE_URL is not set/);
  assert.deepEqual(ran, []);
});

test('the test-database lock lets one run in at a time, and takes over one left for 30 minutes', () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'lock-test-')), 'db.lock');
  assert.deepEqual(takeTestDbLock({ lock }), { ok: true, tookOverMinutes: null });
  assert.deepEqual(takeTestDbLock({ lock }), { ok: false });
  const old = (Date.now() - 31 * 60 * 1000) / 1000;
  utimesSync(lock, old, old);
  assert.deepEqual(takeTestDbLock({ lock }), { ok: true, tookOverMinutes: 31 });
  releaseTestDbLock({ lock });
  assert.deepEqual(takeTestDbLock({ lock }), { ok: true, tookOverMinutes: null });
  releaseTestDbLock({ lock });
});

// The relay's pre-merge step (WC-164).
const SHA = 'a'.repeat(40);
const STEP_ENV = { LOOP_HEAD_SHA: SHA, LOOP_BASE_BRANCH: 'main', LOOP_PR_NUMBER: '170', DATABASE_URL: 'postgresql://u:secretpw@h/db' };
/** A fake git answering the fetch and the diff; records each call. */
function fakeGit({ diff = '', fetchStatus = 0, diffStatus = 0 } = {}) {
  const ran = [];
  const run = (cmd, args) => {
    ran.push([cmd, ...args].join(' '));
    if (args.includes('fetch')) return { status: fetchStatus, stdout: '', stderr: fetchStatus ? 'fatal: could not read from remote' : '' };
    if (args.includes('diff')) return { status: diffStatus, stdout: diff, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, ran };
}

test('pre-merge step: a PR with no database change passes without touching the database', () => {
  const { run, ran } = fakeGit({ diff: 'app/page.tsx\n' });
  let applied = false;
  const r = preMergeStep({ env: STEP_ENV, repoDir: '/repo', run, apply: () => { applied = true; return { ok: true, applied: [] }; } });
  assert.equal(r.code, 0);
  assert.match(r.lines.join('\n'), /no database change/);
  assert.equal(applied, false);
  assert.ok(ran.some((l) => l.includes(`refs/remotes/origin/main...${SHA}`)), 'diffs from where the branch left main');
});

test('pre-merge step: a new migration is applied from the commit about to merge', () => {
  const { run } = fakeGit({ diff: 'supabase/migrations/20261110000000_new.sql\n' });
  let seen;
  const r = preMergeStep({ env: STEP_ENV, repoDir: '/repo', run, apply: (a) => { seen = a; return { ok: true, applied: ['20261110000000_new.sql'] }; } });
  assert.equal(r.code, 0);
  assert.equal(seen.commit, SHA);
  assert.equal(seen.dbUrl, STEP_ENV.DATABASE_URL);
  assert.match(r.lines.join('\n'), /applied 20261110000000_new\.sql to the live database .*read it back/);
});

test('pre-merge step: a migration already live passes and says so', () => {
  const { run } = fakeGit({ diff: 'supabase/migrations/20261110000000_new.sql\n' });
  const r = preMergeStep({ env: STEP_ENV, repoDir: '/repo', run, apply: () => ({ ok: true, applied: [] }) });
  assert.equal(r.code, 0);
  assert.match(r.lines.join('\n'), /already on the live database/);
});

test('pre-merge step: a failed apply exits non-zero, says nothing merged, and never leaks the address', () => {
  const { run } = fakeGit({ diff: 'supabase/migrations/20261110000000_new.sql\n' });
  const r = preMergeStep({ env: STEP_ENV, repoDir: '/repo', run, apply: () => ({ ok: false, error: 'applying x failed: postgresql://u:secretpw@h/db refused' }) });
  assert.equal(r.code, 1);
  const text = r.lines.join('\n');
  assert.match(text, /20261110000000_new\.sql/);
  assert.match(text, /PR #170 was NOT merged/);
  assert.match(text, /npm run db:test/);
  assert.equal(text.includes('secretpw'), false);
});

test('pre-merge step: no database address stops the merge', () => {
  const { run } = fakeGit({ diff: 'supabase/migrations/20261110000000_new.sql\n' });
  const r = preMergeStep({ env: { ...STEP_ENV, DATABASE_URL: '' }, repoDir: '/repo', run, apply: applyMigrations });
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /DATABASE_URL is not set/);
});

test('pre-merge step: a missing or odd commit or branch stops before git runs', () => {
  for (const env of [{ ...STEP_ENV, LOOP_HEAD_SHA: '' }, { ...STEP_ENV, LOOP_HEAD_SHA: '--upload-pack=x' }, { ...STEP_ENV, LOOP_BASE_BRANCH: '-x' }, { ...STEP_ENV, LOOP_BASE_BRANCH: 'a..b' }]) {
    const { run, ran } = fakeGit();
    const r = preMergeStep({ env, repoDir: '/repo', run, apply: () => assert.fail('must not apply') });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /NOT merged/);
    assert.deepEqual(ran, []);
  }
});

test('pre-merge step: git failing to fetch or diff stops the merge', () => {
  for (const g of [fakeGit({ fetchStatus: 128 }), fakeGit({ diffStatus: 128 })]) {
    const r = preMergeStep({ env: STEP_ENV, repoDir: '/repo', run: g.run, apply: () => assert.fail('must not apply') });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /NOT merged/);
  }
});
