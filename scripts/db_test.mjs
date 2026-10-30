#!/usr/bin/env node
/**
 * Test this folder's database changes on the private TEST database, never the
 * live one:
 *
 *   npm run db:test
 *
 * 1. Starts WaveCenter's local Supabase (Docker on the Mac Mini; ports in
 *    supabase/config.toml are the defaults +200, clear of StarCaster's +100).
 * 2. Rebuilds it from nothing with every migration in this folder
 *    (`supabase db reset`), so a broken migration fails here.
 * 3. Runs scripts/check_tasks_rls.mjs against it.
 *
 * The keys come from `supabase status`: Supabase's published local-development
 * defaults, the same on every machine, not secrets. This script runs without
 * Doppler and removes any live address from the environment it hands on, and
 * it refuses to run the check against anything but this machine.
 *
 * The test database is shared by every folder on the machine, so one run at a
 * time holds a lock. The stack is left running for the next run; stop it with
 * `supabase stop` from the repository.
 *
 * Exit 0 = migrations applied and every check held. Exit 1 = something failed.
 */
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isLocalUrl, lastJson } from './lib/migrations.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(tmpdir(), 'wavecenter-db-test.lock');
const STALE_MS = 30 * 60 * 1000;

class Refused extends Error {}
/** Stop the run. Thrown, not process.exit, so the lock is always released. */
function fail(why) {
  throw new Refused(why);
}

function supabase(args, { quiet = false } = {}) {
  const r = spawnSync('supabase', args, { cwd: REPO, encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  if (r.error) fail(`could not run the supabase CLI (${r.error.message}). On the Mac Mini it is /opt/homebrew/bin/supabase; Docker (colima) must be running.`);
  return r;
}

try {
  mkdirSync(LOCK);
} catch {
  let age = 0;
  try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { /* gone already */ }
  if (age < STALE_MS) {
    console.error(`db:test FAILED — another db:test is using the test database (lock ${LOCK}). Run it again when that one finishes.`);
    process.exit(1);
  }
  console.log(`db:test: taking over a lock left ${Math.round(age / 60000)} minutes ago.`);
}

let code = 1;
try {
  console.log('db:test: starting the WaveCenter test database (Docker)...');
  if (supabase(['start']).status !== 0) fail('`supabase start` failed (is Docker running? `colima status`).');

  console.log('db:test: rebuilding it from every migration in this folder...');
  if (supabase(['db', 'reset', '--local', '--yes']).status !== 0) fail('a migration did not apply on the test database — see the error above.');

  const status = supabase(['status', '-o', 'json'], { quiet: true });
  const s = lastJson(status.stdout, 'API_URL');
  if (status.status !== 0 || !s) fail('`supabase status` did not report the test database address.');
  if (!isLocalUrl(s.API_URL)) fail(`the test database address ${s.API_URL} is not on this machine. Refusing.`);

  const env = { ...process.env, SUPABASE_URL: s.API_URL, SUPABASE_ANON_KEY: s.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY };
  delete env.DATABASE_URL;
  console.log(`db:test: running check_tasks_rls against ${s.API_URL} (the test database)...`);
  const check = spawnSync(process.execPath, [join(REPO, 'scripts/check_tasks_rls.mjs')], { cwd: REPO, env, stdio: 'inherit' });
  code = check.status ?? 1;
  console.log(code === 0 ? 'db:test PASSED — every migration applied and every check held, on the test database.' : 'db:test FAILED — see the FAIL lines above.');
} catch (err) {
  if (!(err instanceof Refused)) throw err;
  console.error(`db:test FAILED — ${err.message}`);
  code = 1;
} finally {
  rmSync(LOCK, { recursive: true, force: true });
}
process.exit(code);
