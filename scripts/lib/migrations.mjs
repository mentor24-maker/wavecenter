/**
 * Where a database change goes, and when.
 *
 * On 2026-10-29 a build session applied PR #44's migration straight to the
 * live database so it could run `check:tasks-rls`. The first version had a
 * bug, and the live member list failed for about five minutes, before Dane had
 * written `merge`. Dane's decision the same day ("B it is"): changes are tested
 * on a private test database on the Mac Mini (`npm run db:test`), and only the
 * merge lane applies them to live, on his written `merge`.
 *
 * The merge lane applies a PR's migrations just BEFORE it squash-merges, from
 * the exact commit it is about to merge. If the apply fails, nothing is merged
 * and the ticket stays in Ready to launch with a note: `main` never gets code
 * whose database change did not land. Supabase runs each migration file in its
 * own transaction, so a file that fails leaves nothing half-applied (checked
 * on the test database, 2026-10-29).
 *
 * The pure parts are tested in migrations.test.mjs; `applyMigrations` runs git
 * and the supabase CLI.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MIGRATIONS_DIR = 'supabase/migrations';

/** The migration files among a PR's changed paths, by file name, oldest first. */
export function migrationFiles(paths) {
  const prefix = `${MIGRATIONS_DIR}/`;
  return (paths || [])
    .map((p) => String(p && typeof p === 'object' ? p.path : p))
    .filter((p) => p.startsWith(prefix) && p.endsWith('.sql') && !p.slice(prefix.length).includes('/'))
    .map((p) => p.slice(prefix.length))
    .sort();
}

/**
 * The JSON object carrying `key` in CLI output, or null: the whole output when
 * it is one (pretty-printed) object, else the last such line after the human
 * lines.
 */
export function lastJson(output, key) {
  const whole = String(output || '').trim();
  const lines = [whole, ...whole.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).reverse()];
  for (const line of lines) {
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object' && key in v) return v;
    } catch { /* not JSON; keep looking */ }
  }
  return null;
}

/**
 * The supabase CLI (2.115.0) prints a JSON line only when it thinks an AI
 * agent is running it (CLAUDECODE, CODEX_*, GEMINI_CLI and so on). From
 * launchd, where the merge lane runs, it prints human text instead. Every
 * reader below takes either form; the JSON one wins when both are there.
 */
const plain = (output) => String(output || '').replace(/\x1b\[[0-9;]*m/g, '');

/** The files `supabase db push` says it would push (or pushed), or null if it did not say. */
export function pushList(output) {
  const v = lastJson(output, 'migrations');
  if (v && Array.isArray(v.migrations)) return v.migrations.map(String);
  // Human form: "Would push these migrations:" then one " • <file>.sql" line each.
  const lines = plain(output).split('\n');
  const at = lines.findIndex((l) => l.trim() === 'Would push these migrations:');
  if (at >= 0) {
    const files = [];
    for (const line of lines.slice(at + 1)) {
      const m = line.match(/^\s*\u2022\s+(\S+\.sql)\s*$/);
      if (!m) break;
      files.push(m[1]);
    }
    return files.length ? files : null;
  }
  return lines.some((l) => l.trim() === 'Remote database is up to date.') ? [] : null;
}

/** The versions `supabase migration list` shows in its Remote column, or null when unreadable. */
function remoteVersions(listOutput) {
  const v = lastJson(listOutput, 'migrations');
  if (v && Array.isArray(v.migrations)) return v.migrations.map((m) => String(m && m.remote || '').trim()).filter(Boolean);
  // Human form: a "Local | Remote | Time (UTC)" table, each cell in backticks.
  const lines = plain(listOutput).split('\n');
  if (!lines.some((l) => /^\s*Local\s*\|\s*Remote\s*\|/.test(l))) return null;
  return lines
    .map((l) => l.match(/^\s*`([^`]*)`\s*\|\s*`([^`]*)`\s*\|/))
    .filter(Boolean)
    .map((m) => m[2].trim())
    .filter(Boolean);
}

/**
 * Which of these migration files `supabase migration list` does NOT show as
 * applied on the remote database. Null when the listing could not be read.
 */
export function missingOnRemote(listOutput, files) {
  const remote = remoteVersions(listOutput);
  if (!remote) return null;
  const applied = new Set(remote);
  return (files || []).filter((f) => !applied.has(String(f).split('_')[0]));
}

/**
 * The environment the merge lane runs the CLI in: this one minus every
 * variable the CLI reads as "an AI agent is running me". The lane runs from
 * launchd with none of them set, so stripping them means a Claude session
 * testing this code sees the same human output the lane does.
 */
export function cliEnv(env = process.env) {
  const agent = /^(AGENT|AI_AGENT|CLAUDECODE|REPL_ID|OPENCODE|GEMINI_CLI.*|CLAUDE_CODE.*|CODEX_.*|CURSOR_.*|AUGMENT_.*|OPENCODE_.*|COPILOT_.*)$/;
  return Object.fromEntries(Object.entries(env).filter(([k]) => !agent.test(k)));
}

/** Never let a database address (which carries its password) into a note or a log. */
export function scrub(text) {
  return String(text || '').replace(/postgres(?:ql)?:\/\/\S+/gi, '<database address>');
}

/** The readable error out of a failed supabase CLI run. */
export function cliError(output) {
  const v = lastJson(output, 'error');
  const msg = v && v.error && typeof v.error === 'object' ? v.error.message : null;
  // The CLI's "a new version is available" nudge comes last; it is never the error.
  const lines = plain(output).trim().split('\n').filter((l) => l.trim() && !/^(A new version of Supabase CLI is available|We recommend updating regularly)/.test(l));
  const text = msg || lines.slice(-3).join(' ');
  return scrub(text).slice(0, 400) || 'no message';
}

/** True only for an address on this machine. db:test refuses anything else. */
export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(String(url));
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * The test database is shared by every folder on the machine (db:test and
 * the Evolution screenshots both rebuild it), so one user at a time holds
 * this lock: a folder made atomically, older than 30 minutes counts as left
 * behind.
 */
export const TEST_DB_LOCK = join(tmpdir(), 'wavecenter-db-test.lock');
const LOCK_STALE_MS = 30 * 60 * 1000;

/**
 * Take the test-database lock. Returns { ok: true, tookOverMinutes } (null
 * when the lock was free) or { ok: false } when another run holds it.
 */
export function takeTestDbLock({ lock = TEST_DB_LOCK, now = Date.now() } = {}) {
  try {
    mkdirSync(lock);
    return { ok: true, tookOverMinutes: null };
  } catch {
    let age = 0;
    try { age = now - statSync(lock).mtimeMs; } catch { /* gone already */ }
    if (age < LOCK_STALE_MS) return { ok: false };
    return { ok: true, tookOverMinutes: Math.round(age / 60000) };
  }
}

/** Give the test-database lock back. */
export function releaseTestDbLock({ lock = TEST_DB_LOCK } = {}) {
  rmSync(lock, { recursive: true, force: true });
}

/** The "Database:" paragraph of the merge note. */
export function databaseLine({ files, applied }) {
  if (!files || !files.length) return 'Database: this PR has no database change.';
  if (!applied || !applied.length) return `Database: ${files.join(', ')} was already on the live database; nothing to apply.`;
  return `Database: applied ${applied.join(', ')} to the live database before merging, and read it back from the database's own migration list.`;
}

/**
 * The pre-merge step's own time limit. The relay may wait 10 minutes for a
 * step, but WaveCenter's relay pass is stopped at 480 seconds
 * (`scripts/run_relay.sh`, RELAY_PASS_LIMIT_SECONDS), and a pass stopped from
 * outside leaves no note saying why. So the step gives itself 5 minutes, which
 * leaves the relay time for its gates and the merge, and when it runs out it
 * stops its own command, merges nothing and says so. A migration normally
 * applies in seconds. A command stopped mid-apply drops its connection, and
 * Postgres rolls back the file it was running (each file is one transaction).
 */
export const STEP_BUDGET_MS = 5 * 60 * 1000;

/** spawnSync options giving a command only the time left before `deadline`. */
function budget(deadline, now) {
  if (!Number.isFinite(deadline)) return {};
  return { timeout: Math.max(1, deadline - now()) };
}

/** True when a command was stopped by the time limit (or the limit had already passed). */
function ranOutOfTime(r, deadline, now) {
  if (!Number.isFinite(deadline)) return false;
  return r?.error?.code === 'ETIMEDOUT' || (r?.signal && now() >= deadline) || false;
}

function outOfTimeMessage(cmd, args) {
  const verb = cmd === 'supabase' ? args.slice(0, 2).join(' ') : (args.find((a) => ['fetch', 'diff', 'archive'].includes(a)) || '');
  const what = `${cmd} ${verb}`.trim();
  return `ran out of time: the step's ${STEP_BUDGET_MS / 60000}-minute limit passed during \`${what}\`, so it was stopped. A migration file it was applying rolls back on its own.`;
}

/**
 * Apply the migrations at `commit` to the database at `dbUrl`: everything in
 * that commit's supabase/migrations/ that the database does not have yet. The
 * files come from git, never a working folder, so what is applied is exactly
 * what is merged.
 *
 * Returns { ok: true, applied: [file names] } or { ok: false, error }.
 * Never throws, and never puts `dbUrl` into the error.
 */
export function applyMigrations({ repoDir, commit, dbUrl, run = spawnSync, deadline = Infinity, now = Date.now }) {
  if (!dbUrl) return { ok: false, error: 'DATABASE_URL is not set, so the live database cannot be reached.' };
  const env = cliEnv();
  const sh = (cmd, args) => {
    const r = run(cmd, args, { encoding: 'utf8', cwd: repoDir, env, ...budget(deadline, now) });
    if (ranOutOfTime(r, deadline, now)) return { ok: false, out: outOfTimeMessage(cmd, args) };
    return { ok: r.status === 0, out: `${r.stdout || ''}\n${r.stderr || ''}` };
  };
  const work = mkdtempSync(join(tmpdir(), 'wavecenter-migrations-'));
  try {
    const fetched = sh('git', ['-C', repoDir, 'fetch', '--quiet', 'origin', commit]);
    if (!fetched.ok) return { ok: false, error: `could not fetch commit ${commit}: ${cliError(fetched.out)}` };
    const tar = join(work, 'migrations.tar');
    const archived = sh('git', ['-C', repoDir, 'archive', '-o', tar, commit, MIGRATIONS_DIR]);
    if (!archived.ok) return { ok: false, error: `could not read ${MIGRATIONS_DIR} at ${commit}: ${cliError(archived.out)}` };
    const unpacked = sh('tar', ['-xf', tar, '-C', work]);
    if (!unpacked.ok) return { ok: false, error: `could not unpack the migrations: ${cliError(unpacked.out)}` };

    const push = ['db', 'push', '--db-url', dbUrl, '--workdir', work, '--include-all'];
    const preview = sh('supabase', [...push, '--dry-run']);
    const pending = preview.ok ? pushList(preview.out) : null;
    if (!pending) return { ok: false, error: `supabase could not say what it would apply: ${cliError(preview.out)}` };
    if (!pending.length) return { ok: true, applied: [] };

    const pushed = sh('supabase', [...push, '--yes']);
    if (!pushed.ok) return { ok: false, error: `applying ${pending.join(', ')} failed: ${cliError(pushed.out)}` };

    const listed = sh('supabase', ['migration', 'list', '--db-url', dbUrl, '--workdir', work]);
    const missing = listed.ok ? missingOnRemote(listed.out, pending) : null;
    if (missing === null) return { ok: false, error: `supabase said it applied ${pending.join(', ')}, but the database's migration list could not be read back: ${cliError(listed.out)}` };
    if (missing.length) return { ok: false, error: `supabase said it applied ${pending.join(', ')}, but the database does not list ${missing.join(', ')}.` };
    return { ok: true, applied: pending };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The relay's pre-merge step (WC-164, on Spirality's SP-185 hook): what used
 * to be the merge lane's database step before WaveCenter moved onto
 * Spirality's loop. The relay runs `scripts/apply_migrations.mjs` (configured
 * as `../scripts/apply_migrations.mjs`, because the vendored relay runs it from
 * the main checkout's `loop/` folder) once every gate says merge, and before `gh pr merge`, telling
 * it the pull request in LOOP_* variables. A non-zero exit merges nothing and
 * leaves Dane's `merge` unspent, so the relay runs it again next pass: it must
 * be safe to run twice, and it is (it only applies what the database lacks).
 *
 * The migration files come from git at LOOP_HEAD_SHA, never the checkout, and
 * the relay merges only that commit (`--match-head-commit`).
 *
 * Returns { code, lines }: the exit code and the lines to print (the relay
 * quotes the last ones on the ticket). Never throws, never prints the address.
 */
export function preMergeStep({ env = process.env, repoDir, run = spawnSync, apply = applyMigrations, now = Date.now, budgetMs = STEP_BUDGET_MS } = {}) {
  const deadline = now() + budgetMs;
  const sha = String(env.LOOP_HEAD_SHA || '').trim();
  const base = String(env.LOOP_BASE_BRANCH || '').trim();
  const pr = String(env.LOOP_PR_NUMBER || '').trim();
  const name = pr ? `PR #${pr}` : 'This PR';
  const stop = (why) => ({
    code: 1,
    lines: [
      `Database step: ${why}`,
      `${name} was NOT merged. The relay tries again on its next pass and merges once this step passes.`,
    ],
  });
  if (!/^[0-9a-f]{40}$/.test(sha)) return stop(`the relay did not give the commit about to merge (LOOP_HEAD_SHA is "${sha.slice(0, 60)}"), so its database change cannot be read.`);
  if (!/^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/.test(base) || base.includes('..')) return stop(`the relay did not give a usable branch to merge into (LOOP_BASE_BRANCH is "${base.slice(0, 60)}").`);

  const git = (args) => {
    const r = run('git', ['-C', repoDir, ...args], { encoding: 'utf8', cwd: repoDir, ...budget(deadline, now) });
    if (ranOutOfTime(r, deadline, now)) return { ok: false, stdout: '', out: outOfTimeMessage('git', args) };
    return { ok: r.status === 0, stdout: String(r.stdout || ''), out: `${r.stdout || ''}\n${r.stderr || ''}` };
  };
  const fetched = git(['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`, sha]);
  if (!fetched.ok) return stop(`could not fetch ${base} and commit ${sha.slice(0, 12)} from GitHub: ${cliError(fetched.out)}`);
  // Three dots: what the branch changed since it left the base, not what the base did since.
  const changed = git(['diff', '--name-only', `refs/remotes/origin/${base}...${sha}`, '--', MIGRATIONS_DIR]);
  if (!changed.ok) return stop(`could not tell which database files ${name} changes: ${cliError(changed.out)}`);
  const files = migrationFiles(changed.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  if (!files.length) return { code: 0, lines: [databaseLine({ files })] };

  const r = apply({ repoDir, commit: sha, dbUrl: env.DATABASE_URL, run, deadline, now });
  if (!r.ok) {
    return {
      code: 1,
      lines: [
        `Database step: ${name} changes the database (${files.join(', ')}), and applying it to the live database from commit ${sha.slice(0, 12)} failed: ${scrub(r.error)}`,
        `${name} was NOT merged. Each migration file is all-or-nothing, so a file that failed left nothing behind (a file listed before it may have applied). The relay tries again on its next pass; if it fails the same way, the migration has to be fixed on this branch and pass \`npm run db:test\` on the test database.`,
      ],
    };
  }
  return { code: 0, lines: [databaseLine({ files, applied: r.applied })] };
}
