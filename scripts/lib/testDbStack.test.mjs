import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestDb, mainCheckout, parseContainers, projectId, repairReasons } from './testDbStack.mjs';

const MAIN = '/Users/dane/WebApps/wavecenter';
const GONE = '/Users/dane/WebApps/wavecenter/.claude/worktrees/old-thing';
const STATUS = JSON.stringify({ API_URL: 'http://127.0.0.1:54521', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'service' });

function container(name, { running = true, source = `${MAIN}/supabase/templates/recovery.html`, workdir = MAIN } = {}) {
  return {
    Name: `/${name}`,
    State: { Running: running, Status: running ? 'running' : 'exited' },
    Config: { Labels: { 'com.supabase.cli.project': 'wavecenter', 'com.supabase.cli.workdir': workdir } },
    Mounts: [{ Type: 'bind', Source: source }, { Type: 'volume', Name: 'x', Source: '/var/lib/docker/volumes/x' }],
  };
}

/**
 * A fake Docker + Supabase CLI. `before` is the stack as found; after a
 * `supabase start` from `MAIN` it becomes `after`. Every call is recorded.
 */
function fakeMachine({ before, after = before, statusBefore = STATUS, statusAfter = STATUS }) {
  const calls = [];
  let restarted = false;
  const run = (cmd, args, { cwd } = {}) => {
    calls.push({ cmd: [cmd, ...args].join(' '), cwd });
    const stack = restarted ? after : before;
    if (cmd === 'supabase' && args[0] === 'status') {
      const out = restarted ? statusAfter : statusBefore;
      return out ? { status: 0, stdout: out, stderr: 'Stopped services: [supabase_studio_wavecenter]' } : { status: 1, stdout: '', stderr: 'failed to inspect container' };
    }
    if (cmd === 'supabase' && args[0] === 'stop') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'supabase' && args[0] === 'start') {
      if (cwd === MAIN) restarted = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'docker' && args[0] === 'ps') return { status: 0, stdout: stack.map((c) => c.Name.slice(1)).join('\n') + '\n', stderr: '' };
    if (cmd === 'docker' && args[0] === 'inspect') return { status: 0, stdout: JSON.stringify(stack), stderr: '' };
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  };
  return { run, calls };
}

const exists = (p) => !p.startsWith(GONE);
const healthy = [container('supabase_db_wavecenter'), container('supabase_kong_wavecenter')];

test('a stack with a missing mount path is restarted from the main checkout once, then read again', () => {
  const broken = [
    container('supabase_db_wavecenter'),
    container('supabase_kong_wavecenter', { running: false, source: `${GONE}/supabase/templates/recovery.html`, workdir: GONE }),
  ];
  const m = fakeMachine({ before: broken, after: healthy, statusBefore: null });
  const got = ensureTestDb({ run: m.run, exists, main: MAIN, project: 'wavecenter' });

  assert.equal(got.ok, true);
  assert.equal(got.repaired, true);
  assert.equal(got.status.API_URL, 'http://127.0.0.1:54521');
  assert.ok(got.reasons.some((r) => r.includes(`${GONE}/supabase/templates/recovery.html`)), got.reasons.join(' | '));
  assert.ok(got.reasons.some((r) => r.includes('supabase_kong_wavecenter (exited)')), got.reasons.join(' | '));

  const restarts = m.calls.filter((c) => c.cmd === 'supabase stop' || c.cmd === 'supabase start');
  assert.deepEqual(restarts, [{ cmd: 'supabase stop', cwd: MAIN }, { cmd: 'supabase start', cwd: MAIN }]);
  const lastStop = m.calls.findIndex((c) => c.cmd === 'supabase start');
  assert.ok(m.calls.slice(lastStop + 1).some((c) => c.cmd === 'supabase status -o json'), 'the status is read again after the restart');
});

test('a missing mount alone (Kong still up) is enough to restart', () => {
  const stale = [container('supabase_kong_wavecenter', { source: `${GONE}/supabase/templates/recovery.html` })];
  const m = fakeMachine({ before: stale, after: healthy });
  const got = ensureTestDb({ run: m.run, exists, main: MAIN, project: 'wavecenter' });
  assert.equal(got.repaired, true);
  assert.equal(m.calls.filter((c) => c.cmd === 'supabase start').length, 1);
});

test('a healthy stack is not restarted', () => {
  const m = fakeMachine({ before: healthy });
  const got = ensureTestDb({ run: m.run, exists, main: MAIN, project: 'wavecenter' });
  assert.equal(got.ok, true);
  assert.equal(got.repaired, false);
  assert.equal(got.status.ANON_KEY, 'anon');
  assert.equal(m.calls.filter((c) => c.cmd.startsWith('supabase stop') || c.cmd.startsWith('supabase start')).length, 0);
});

test('a gone folder in the workdir label, with no bind mount from it, is not restarted', () => {
  // `supabase db reset` run from a worktree (db:test) or a deleted temp folder
  // (Evolution capture) re-creates supabase_db_wavecenter labelled with that
  // folder, but mounts nothing from it, so the stack is healthy.
  const db = container('supabase_db_wavecenter', { workdir: GONE });
  db.Mounts = [{ Type: 'volume', Name: 'db', Source: '/var/lib/docker/volumes/db' }];
  const m = fakeMachine({ before: [db, container('supabase_kong_wavecenter')] });
  const got = ensureTestDb({ run: m.run, exists, main: MAIN, project: 'wavecenter' });
  assert.equal(got.ok, true);
  assert.equal(got.repaired, false, got.reasons.join(' | '));
  assert.equal(m.calls.filter((c) => c.cmd === 'supabase stop' || c.cmd === 'supabase start').length, 0);
});

test('disabled services in "Stopped services" are never a reason to restart', () => {
  // The fake status always prints "Stopped services: [supabase_studio_wavecenter]"
  // with no such container, as the real CLI does for services config.toml turns off.
  assert.deepEqual(repairReasons({ reported: true, containers: parseContainers(JSON.stringify(healthy)), exists }), []);
});

test('when the restart does not bring the address back, the message names the stopped service and the missing path', () => {
  const broken = [container('supabase_kong_wavecenter', { running: false, source: `${GONE}/supabase/templates/recovery.html` })];
  const m = fakeMachine({ before: broken, after: broken, statusBefore: null, statusAfter: null });
  const got = ensureTestDb({ run: m.run, exists, main: MAIN, project: 'wavecenter' });
  assert.equal(got.ok, false);
  assert.match(got.message, /supabase_kong_wavecenter \(exited\)/);
  assert.match(got.message, /old-thing\/supabase\/templates\/recovery\.html/);
  assert.equal(m.calls.filter((c) => c.cmd === 'supabase start').length, 1, 'restarted once, never in a loop');
});

test('mainCheckout strips .git from the common dir; projectId reads config.toml', () => {
  const run = () => ({ status: 0, stdout: `${MAIN}/.git\n` });
  assert.equal(mainCheckout(GONE, run), MAIN);
  assert.equal(mainCheckout(MAIN, () => ({ status: 128, stdout: '' })), MAIN);
  assert.equal(projectId('# x\nproject_id = "wavecenter"\n'), 'wavecenter');
  assert.equal(projectId(''), 'wavecenter');
  assert.equal(parseContainers('not json'), null);
});
