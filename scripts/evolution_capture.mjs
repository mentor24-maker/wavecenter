#!/usr/bin/env node
/**
 * The Evolution screenshot taker: a picture of what WaveCenter looked like
 * after each change merged into main, with the real tasks, members and
 * points as they stood at that moment (Dane, 2026-10-30: "Use real data. We
 * can always redact later.").
 *
 *   npm run evolution -- capture <sha>                    picture one change and record it
 *   npm run evolution -- capture <sha> --dry-run <file>   picture it into <file>; store and record nothing
 *   npm run evolution -- backfill                         every first-parent change on main, oldest first,
 *                                                         skipping ones already captured
 *   npm run evolution -- missing                          every first-parent change on main with no row
 *                                                         yet, oldest first (the merge lane runs this)
 *   npm run evolution -- words                            fill Dane's words and their thread on every
 *                                                         recorded change that has none yet; no pictures
 *   npm run evolution -- list                             one line per recorded change
 *
 * Runs on the Mac Mini only: it needs the test database (Docker), and Doppler
 * supplies the live keys. `capture` for one change:
 *
 *   1. Works out the change's page (scripts/lib/evolution.mjs, choosePage).
 *      No app/ change, or no app yet: a text-only "no screen" row, no picture.
 *   2. Checks the change out in a temporary git worktree, installs its
 *      packages and builds it. A change that will not build or start is a
 *      "failed" row with the reason in plain words.
 *   3. Under the test database's lock (the one `npm run db:test` takes),
 *      rebuilds the test database from THAT change's migrations, then copies
 *      in the live rows as they stood at its merge time (asOf), reading live
 *      with the service key and only ever reading.
 *   4. Starts the old app against the test database ONLY: its environment is
 *      built from nothing, holds the local address and public demo key, and
 *      the run refuses an address that is not on this machine (isLocalUrl,
 *      the same guard as db:test). The old app never sees a live key.
 *   5. Signs in as Dane's member account in the local copy, takes a 1280x800
 *      screenshot with a headless browser, uploads it to the private
 *      `evolution` bucket and upserts the `evolution_entries` row on live.
 *   6. Wipes the local copy (`supabase db reset`), pass or fail, so real
 *      member data does not sit in the shared test database.
 *
 * What "as they stood" can and cannot show. It is rebuilt from the columns the
 * database already keeps: members whose account was made by then; tasks made
 * by then, counted done only if `completed_at` is by then (otherwise open);
 * comments, votes, files and points (engagements) made by then; each member's
 * settings, profile and role as they are today. Nothing records deleted
 * tasks, earlier wordings of an edited title or comment, in-between statuses,
 * earlier profile names, or earlier points, so those cannot be shown: a task
 * appears with today's title and points, and a deleted one does not appear at
 * all. Attached files appear as their rows; the stored files themselves are
 * not copied, so a picture of one will not load. Columns that did not exist
 * at a change are dropped and tables that did not exist are skipped.
 *
 * `missing` is the merge lane's step after each merge (scripts/merge_lane.sh,
 * under a time limit). Because it fills whatever has no row, a pass that was
 * skipped, failed to start or was stopped heals itself on the next one. A
 * picture that fails for a ticket the lane merged gets a `failed` row and one
 * plain comment on that ticket; the merge and the ticket's status are never
 * touched. Stopped at the time limit (SIGTERM), a capture records nothing,
 * wipes the local copy and gives the test database back, so the next pass
 * retakes it from the start.
 *
 * Each row also keeps Dane's own words behind the change and a link to
 * where he said them (danesWords), read from its ClickUp ticket through
 * `scripts/clickup.mjs ticket-json`. The Evolution cards show those words.
 * A ticket that cannot be read leaves them empty, and `words` fills them
 * on a later run without retaking any picture.
 *
 * Exit 0 = done. Exit 1 = something failed, said in plain words; a picture
 * that was not stored is never recorded as captured (engineering rule 6).
 * Exit 143 = stopped at the time limit.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { isLocalUrl, lastJson, cliError, scrub, takeTestDbLock, releaseTestDbLock, TEST_DB_LOCK } from './lib/migrations.mjs';
import { asOf, BUCKET, choosePage, COPIED_TABLES, danesWords, entryRow, failureComment, fillPage, laneCapturedOnMerge, listLine, missingShas, parseSubject, ticketId, ticketUrl } from './lib/evolution.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
// Dane's member account, the earliest one (20261029120000_member_roles.sql makes it the first admin).
const DANE_ID = '3cb23781-b16b-4fae-93e0-85e51915641c';
const VIEWPORT = { width: 1280, height: 800 };

const LIVE_URL = process.env.SUPABASE_URL;
const LIVE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** A step that failed for a reason worth recording on the change's row. */
class CaptureFailed extends Error {}
/** Something wrong with the run itself (keys, storage, the live table): stop. */
class RunFailed extends Error {}
/** The time limit stopped the run: record nothing, so the next pass retakes it. */
class Stopped extends Error {}

// scripts/run_with_time_limit.sh sends SIGTERM to this process and every
// child at once. A killed `npm ci` or `next build` would otherwise look like
// a change that does not build, so a stop is only noted here, and capture()
// checks it before recording anything.
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
const settle = () => new Promise((r) => setTimeout(r, 200));

function sh(cmd, args, { cwd = REPO, env, input, quiet = true } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new RunFailed(`could not run ${cmd}: ${r.error.message}`);
  return { ok: r.status === 0, out: `${r.stdout || ''}\n${r.stderr || ''}`, stdout: r.stdout || '' };
}

function git(args) {
  const r = sh('git', ['-C', REPO, ...args]);
  if (!r.ok) throw new RunFailed(`git ${args[0]} failed: ${cliError(r.out)}`);
  return r.stdout.trim();
}

/** The last few lines of a failed step's output, for its row. */
function tail(out) {
  return scrub(String(out || '').trim().split('\n').filter(Boolean).slice(-3).join(' ')).slice(0, 300);
}

// ---------------------------------------------------------------- live (Doppler)

function requireLive() {
  if (!LIVE_URL || !LIVE_KEY) throw new RunFailed('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set; run it as `npm run evolution -- …` so Doppler supplies them.');
}

async function live(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const res = await fetch(`${LIVE_URL}${path}`, {
    method,
    headers: { apikey: LIVE_KEY, Authorization: `Bearer ${LIVE_KEY}`, ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  }).catch((err) => { throw new RunFailed(`could not reach the live database: ${err.cause?.code ?? err.message}`); });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

/** Every row of a live table (read only), a page of 1000 at a time. */
async function liveRows(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const got = await live(`/rest/v1/${table}?select=*`, { headers: { Range: `${from}-${from + 999}` } });
    if (got.status >= 300) throw new RunFailed(`could not read live ${table}: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    rows.push(...got.json);
    if (got.json.length < 1000) return rows;
  }
}

async function liveUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const got = await live(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    if (got.status >= 300) throw new RunFailed(`could not read the live member list: HTTP ${got.status}`);
    users.push(...got.json.users);
    if (got.json.users.length < 1000) return users;
  }
}

let liveSnapshot = null;
/** The live rows, read once per run. */
async function liveData() {
  if (!liveSnapshot) {
    const tables = {};
    for (const t of COPIED_TABLES) tables[t] = await liveRows(t);
    liveSnapshot = { users: await liveUsers(), tables };
  }
  return liveSnapshot;
}

/**
 * Store the screenshot, then the row; read each back. Throws RunFailed on
 * any failure. Empty words are left out of the write, so retaking a picture
 * while ClickUp cannot be read never wipes words already stored.
 */
async function record(fullRow, pngFile) {
  const row = { ...fullRow };
  if (row.prompt == null) { delete row.prompt; delete row.thread_url; }
  if (row.capture_state === 'captured') {
    const put = await live(`/storage/v1/object/${BUCKET}/${row.screenshot_path}`, {
      method: 'POST', raw: readFileSync(pngFile), headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
    });
    if (put.status >= 300) {
      const failed = { ...row, screenshot_path: null, capture_state: 'failed', failure_reason: `the screenshot was taken but could not be stored (HTTP ${put.status})` };
      await live('/rest/v1/evolution_entries?on_conflict=commit_sha', { method: 'POST', body: failed, headers: { Prefer: 'resolution=merge-duplicates' } });
      throw new RunFailed(`uploading the screenshot ${row.screenshot_path} failed: HTTP ${put.status} ${JSON.stringify(put.json)}`);
    }
  }
  const saved = await live('/rest/v1/evolution_entries?on_conflict=commit_sha', {
    method: 'POST', body: { ...row, captured_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  const back = Array.isArray(saved.json) ? saved.json[0] : null;
  if (saved.status >= 300 || !back || back.capture_state !== row.capture_state || back.screenshot_path !== row.screenshot_path) {
    throw new RunFailed(`writing the evolution_entries row for ${row.commit_sha.slice(0, 7)} failed: HTTP ${saved.status} ${JSON.stringify(saved.json)}`);
  }
}

// ---------------------------------------------------------------- the test database

function localStack() {
  const status = sh('supabase', ['status', '-o', 'json']);
  const s = lastJson(status.stdout, 'API_URL');
  if (!status.ok || !s) throw new RunFailed('`supabase status` did not report the test database. Start it with `npm run db:test` (Docker must be running: `colima status`).');
  if (!isLocalUrl(s.API_URL)) throw new RunFailed(`the test database address ${s.API_URL} is not on this machine. Refusing.`);
  return { url: s.API_URL, anon: s.ANON_KEY, service: s.SERVICE_ROLE_KEY };
}

function dbContainer() {
  const m = readFileSync(join(REPO, 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
  return `supabase_db_${m ? m[1] : 'wavecenter'}`;
}

function psql(sql) {
  const r = sh('docker', ['exec', '-i', dbContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], { input: sql });
  if (!r.ok) throw new CaptureFailed(`the live rows did not fit this change's database: ${tail(r.out)}`);
  return r.stdout.trim();
}

/** Rebuild the test database from `sha`'s migrations (null: this folder's own, which wipes the copy). */
function resetTestDb(sha) {
  let workdir = REPO;
  if (sha) {
    workdir = mkdtempSync(join(tmpdir(), 'wavecenter-evolution-db-'));
    mkdirSync(join(workdir, 'supabase/migrations'), { recursive: true });
    copyFileSync(join(REPO, 'supabase/config.toml'), join(workdir, 'supabase/config.toml'));
    const listed = git(['ls-tree', '--name-only', `${sha}:supabase/migrations`]).split('\n').filter((f) => f.endsWith('.sql'));
    for (const f of listed) writeFileSync(join(workdir, 'supabase/migrations', f), git(['show', `${sha}:supabase/migrations/${f}`]) + '\n');
  }
  try {
    const r = sh('supabase', ['db', 'reset', '--local', '--yes', '--workdir', workdir]);
    if (!r.ok) {
      if (sha) throw new CaptureFailed(`this change's migrations did not build the test database: ${cliError(r.out)}`);
      throw new RunFailed(`wiping the local copy failed (${cliError(r.out)}). Run \`npm run db:test\` to wipe it.`);
    }
  } finally {
    if (sha) rmSync(workdir, { recursive: true, force: true });
  }
}

/** Wipe the local copy. A stop signal can cut the wipe itself short, so then it goes once more. */
function wipe() {
  try {
    resetTestDb(null);
  } catch (err) {
    if (!stopping) throw err;
    console.log('  the stop cut the wipe short; wiping again...');
    resetTestDb(null);
  }
}

async function localCall(local, path, { method = 'GET', body, key = local.service, token = key } = {}) {
  const res = await fetch(`${local.url}${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A dollar-quoted SQL literal that cannot be closed by its own contents. */
function quoted(text) {
  const tag = `j${randomBytes(6).toString('hex')}`;
  return `$${tag}$${text}$${tag}$`;
}

/**
 * Copy the live rows as they stood at `mergedAt` into the test database, and
 * return Dane's session there. Every write goes to the local stack.
 */
async function copyLive(local, mergedAt) {
  const columns = JSON.parse(psql(`select coalesce(json_object_agg(table_name, cols), '{}') from (select table_name, json_agg(column_name::text) cols from information_schema.columns where table_schema = 'public' group by table_name) x;`) || '{}');
  const { users, tables } = asOf(await liveData(), { mergedAt, columns });

  const password = randomBytes(24).toString('base64url');
  for (const u of users) {
    const made = await localCall(local, '/auth/v1/admin/users', {
      method: 'POST',
      body: { id: u.id, email: u.email, email_confirm: true, user_metadata: u.user_metadata ?? {}, ...(u.id === DANE_ID ? { password } : {}) },
    });
    if (made.status >= 300) throw new CaptureFailed(`could not copy a member into the local copy: HTTP ${made.status} ${made.json?.msg ?? ''}`);
  }

  const sql = ['begin;', 'set local session_replication_role = replica;'];
  const stamps = JSON.stringify(users.map((u) => ({ id: u.id, created_at: u.created_at })));
  sql.push(`update auth.users u set created_at = x.created_at, updated_at = x.created_at from json_to_recordset(${quoted(stamps)}) x(id uuid, created_at timestamptz) where u.id = x.id;`);
  for (const [name, rows] of Object.entries(tables)) {
    sql.push(`delete from public.${name};`);
    if (!rows.length) continue;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((c) => `"${c}"`).join(', ');
    sql.push(`insert into public.${name} (${cols}) select ${cols} from json_populate_recordset(null::public.${name}, ${quoted(JSON.stringify(rows))});`);
  }
  sql.push('commit;');
  psql(sql.join('\n'));

  if (!users.some((u) => u.id === DANE_ID)) throw new CaptureFailed('Dane’s account did not exist yet at this change, so there was nobody to sign in as.');
  const dane = users.find((u) => u.id === DANE_ID);
  const signin = await localCall(local, '/auth/v1/token?grant_type=password', { method: 'POST', key: local.anon, body: { email: dane.email, password } });
  if (signin.status >= 300) throw new CaptureFailed(`could not sign in as Dane in the local copy: HTTP ${signin.status}`);
  await settleClock(local, signin.json.access_token);
  return { session: signin.json, tasks: tables.tasks || [] };
}

const CLOCK_SKEW = /issued at future/i;

/**
 * Just after `supabase db reset` restarts it, the test database's API can
 * run on a stale clock for a few seconds and refuse a just-issued sign-in as
 * "JWT issued at future" (seen 2026-10-31). Wait until it accepts one.
 */
async function settleClock(local, token) {
  for (let i = 0; i < 30; i += 1) {
    const got = await localCall(local, '/rest/v1/tasks?select=id&limit=1', { key: local.anon, token });
    if (!CLOCK_SKEW.test(JSON.stringify(got.json))) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new CaptureFailed('the test database kept refusing a fresh sign-in as issued in the future (its clock did not settle)');
}

// ---------------------------------------------------------------- the old app

/** The old app's whole environment: the local address and public demo key, nothing from Doppler. */
function appEnv(local) {
  if (!isLocalUrl(local.url)) throw new RunFailed(`refusing to start an old app against ${local.url}: not the test database on this machine.`);
  const env = { NEXT_TELEMETRY_DISABLED: '1', SUPABASE_URL: local.url, SUPABASE_ANON_KEY: local.anon };
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'SHELL']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/** A build environment with no keys at all. */
function buildEnv() {
  const env = { NEXT_TELEMETRY_DISABLED: '1' };
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'SHELL']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function freePort() {
  return new Promise((ok, no) => {
    const srv = createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => ok(port)); });
    srv.on('error', no);
  });
}

/** Check the change out and build it. Returns the folder; throws CaptureFailed. */
function buildAt(sha) {
  const dir = mkdtempSync(join(tmpdir(), `wavecenter-evolution-${sha.slice(0, 7)}-`));
  rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'add', '--detach', '--force', dir, sha]);
  const env = buildEnv();
  console.log(`  installing ${sha.slice(0, 7)}'s packages...`);
  const installed = sh('npm', ['ci', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: dir, env });
  if (!installed.ok) throw Object.assign(new CaptureFailed(`the app at this change would not install its packages: ${tail(installed.out)}`), { dir });
  console.log('  building it...');
  let built = sh('npx', ['next', 'build'], { cwd: dir, env });
  // Next.js 16.4.0 sometimes stops a build with a one-off upgrade notice; a second try passes.
  if (!built.ok) built = sh('npx', ['next', 'build'], { cwd: dir, env });
  if (!built.ok) throw Object.assign(new CaptureFailed(`the app at this change did not build: ${tail(built.out)}`), { dir });
  return dir;
}

function dropWorktree(dir) {
  if (!dir) return;
  sh('git', ['-C', REPO, 'worktree', 'remove', '--force', dir]);
  rmSync(dir, { recursive: true, force: true });
  sh('git', ['-C', REPO, 'worktree', 'prune']);
}

/** The session cookies the old app expects, made by that change's own @supabase/ssr. */
function sessionCookies(dir, local, session) {
  const helper = join(dir, '.evolution-session.mjs');
  writeFileSync(helper, `
import { createServerClient } from '@supabase/ssr';
const jar = new Map();
const c = createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => { for (const { name, value } of l) jar.set(name, value); } },
});
const s = JSON.parse(process.env.SESSION);
const { error } = await c.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
if (error) { console.error(error.message); process.exit(1); }
console.log(JSON.stringify([...jar]));
`);
  const r = sh(process.execPath, [helper], { cwd: dir, env: { ...appEnv(local), SESSION: JSON.stringify(session) } });
  rmSync(helper, { force: true });
  if (!r.ok) throw new CaptureFailed(`could not sign in as Dane with this change's own sign-in code: ${tail(r.out)}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

async function startApp(dir, local) {
  const port = await freePort();
  const child = spawn('npx', ['next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: dir, env: appEnv(local), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) break;
    try { await fetch(base, { redirect: 'manual' }); return { base, stop }; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  stop();
  throw new CaptureFailed(`the app at this change did not start: ${tail(out)}`);
}

async function screenshot({ base, page, cookies, file }) {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new RunFailed(`the headless browser would not start (${String(err.message).split('\n')[0]}). Install it once with \`npx playwright install chromium-headless-shell\`.`);
  }
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    if (cookies.length) await context.addCookies(cookies.map(([name, value]) => ({ name, value, url: base })));
    const tab = await context.newPage();
    let res = null;
    for (let i = 0; i < 5; i += 1) {
      res = await tab.goto(`${base}${page}`, { waitUntil: 'networkidle', timeout: 60000 });
      if (!CLOCK_SKEW.test(await tab.content())) break;
      if (i === 4) throw new CaptureFailed('the page kept showing "JWT issued at future": the test database clock did not settle');
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!res) throw new CaptureFailed(`the page ${page} did not load`);
    if (res.status() >= 500) throw new CaptureFailed(`the page ${page} answered with a server error (HTTP ${res.status()})`);
    const landed = new URL(tab.url()).pathname;
    if (cookies.length && page !== '/sign-in' && landed === '/sign-in') throw new CaptureFailed('the old app sent the screenshot to the sign-in page: signing in as Dane did not hold');
    await tab.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- one change

function commitInfo(rev) {
  const sha = git(['rev-parse', `${rev}^{commit}`]);
  const [mergedAt, parents, subject] = git(['show', '-s', '--format=%cI%n%P%n%s', sha]).split('\n');
  const parent = parents.split(' ').filter(Boolean)[0];
  const changed = (parent ? git(['diff', '--name-only', parent, sha]) : git(['show', '--name-only', '--format=', sha])).split('\n').filter(Boolean);
  const files = git(['ls-tree', '-r', '--name-only', sha]).split('\n').filter(Boolean);
  const { title, prNumber } = parseSubject(subject);
  let ticket = ticketUrl(git(['show', '-s', '--format=%b', sha]));
  if (!ticket && prNumber) {
    const pr = sh('gh', ['pr', 'view', String(prNumber), '--json', 'body', '-q', '.body']);
    if (pr.ok) ticket = ticketUrl(pr.stdout);
  }
  return { sha, mergedAt, title, prNumber, ticketUrl: ticket, changed, files };
}

/**
 * Dane's words behind a change, from its ticket: { prompt, threadUrl }, both
 * null when the ticket holds none, or null when the ticket could not be read
 * (said in the output, never recorded as "none").
 */
function ticketWords(url) {
  const task = ticketId(url);
  if (!task) return { prompt: null, threadUrl: null };
  const got = sh(process.execPath, [join(REPO, 'scripts/clickup.mjs'), 'ticket-json', '--task', task]);
  const json = got.ok ? got.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1) : null;
  if (!json) {
    console.log(`  could not read ticket ${task} for Dane's words: ${tail(got.out)}`);
    return null;
  }
  try { return danesWords(JSON.parse(json)); } catch (err) {
    console.log(`  could not read ticket ${task} for Dane's words: ${err.message}`);
    return null;
  }
}

/**
 * Picture one change. Returns the row it recorded (or would record, with
 * `dryRun`). Throws RunFailed when the run itself broke.
 */
async function capture(rev, { dryRun = null } = {}) {
  const info = commitInfo(rev);
  const words = ticketWords(info.ticketUrl) ?? { prompt: null, threadUrl: null };
  const base = { sha: info.sha, mergedAt: info.mergedAt, prNumber: info.prNumber, title: info.title, ticketUrl: info.ticketUrl, ...words };
  const pattern = choosePage(info);
  console.log(`${info.sha.slice(0, 7)} ${info.title}\n  page: ${pattern ?? 'no screen'}`);
  const finish = async (row, png) => {
    if (dryRun) {
      console.log(`  dry run, nothing stored: ${JSON.stringify(row)}`);
    } else {
      await record(row, png);
      console.log(`  recorded: ${row.capture_state}${row.failure_reason ? ` — ${row.failure_reason}` : ''}`);
    }
    return row;
  };
  if (!pattern) return finish(entryRow({ ...base, state: 'no screen' }));

  const usesDb = info.files.some((f) => f.startsWith('supabase/migrations/'));
  const png = dryRun ? resolve(dryRun) : join(tmpdir(), `wavecenter-evolution-${info.sha}.png`);
  let dir = null;
  let page = pattern;
  let locked = false;
  let stopApp = null;
  try {
    dir = buildAt(info.sha);
    const local = usesDb ? localStack() : { url: 'http://127.0.0.1:1', anon: 'none' };
    let cookies = [];
    if (usesDb) {
      const lock = takeTestDbLock();
      if (!lock.ok) throw new RunFailed(`another run is using the test database (lock ${TEST_DB_LOCK}). Try again when it finishes.`);
      locked = true;
      console.log(`  rebuilding the test database from this change's migrations and copying in the live rows as of ${info.mergedAt}...`);
      resetTestDb(info.sha);
      const { session, tasks } = await copyLive(local, info.mergedAt);
      page = fillPage(pattern, tasks);
      if (!page) throw new CaptureFailed(`the page ${pattern} needs a task, and no task existed yet`);
      if (existsSync(join(dir, 'node_modules/@supabase/ssr')) && page !== '/sign-in') cookies = sessionCookies(dir, local, session);
    }
    console.log(`  starting it and photographing ${page}...`);
    const app = await startApp(dir, local);
    stopApp = app.stop;
    await screenshot({ base: app.base, page, cookies, file: png });
    return await finish(entryRow({ ...base, page, screenshotPath: `${info.sha}.png`, state: 'captured' }), png);
  } catch (err) {
    if (err.dir) dir = err.dir;
    await settle(); // let a stop signal that arrived with the failure land first
    if (stopping) throw new Stopped(`stopped part-way through ${info.sha.slice(0, 7)}; nothing was recorded for it`);
    if (!(err instanceof CaptureFailed)) throw err;
    return await finish(entryRow({ ...base, page, state: 'failed', reason: err.message }));
  } finally {
    if (stopApp) stopApp();
    try {
      if (locked) {
        console.log('  wiping the local copy...');
        try { wipe(); } finally { releaseTestDbLock(); }
      }
    } finally {
      dropWorktree(dir);
      if (!dryRun) rmSync(png, { force: true });
    }
  }
}

/** Tell the ticket its picture could not be taken: one plain comment, nothing else. */
function tellTicket(row) {
  const parent = sh('git', ['-C', REPO, 'show', `${row.commit_sha}^1:scripts/merge_lane.sh`]);
  if (!laneCapturedOnMerge(parent.ok ? parent.stdout : '')) return;
  const task = ticketId(row.ticket_url);
  if (!task) {
    console.log('  no ticket link on this change, so no ticket to tell.');
    return;
  }
  const sent = sh(process.execPath, [join(REPO, 'scripts/clickup.mjs'), 'comment', '--task', task, '--body-file', '-'], { input: failureComment(row) });
  console.log(sent.ok ? `  told ticket ${task} the screenshot could not be taken.` : `  could not comment on ticket ${task}: ${tail(sent.out)}`);
}

async function recorded() {
  const got = await live('/rest/v1/evolution_entries?select=*&order=merged_at');
  if (got.status >= 300) throw new RunFailed(`could not read evolution_entries: HTTP ${got.status} ${JSON.stringify(got.json)}`);
  return got.json;
}

// ---------------------------------------------------------------- commands

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'capture' && rest[0]) {
    const dryAt = rest.indexOf('--dry-run');
    const dryRun = dryAt >= 0 ? rest[dryAt + 1] : null;
    if (dryAt >= 0 && !dryRun) throw new RunFailed('--dry-run needs a file to write the screenshot to.');
    requireLive();
    const row = await capture(rest[0], { dryRun });
    process.exit(row.capture_state === 'failed' ? 1 : 0);
  } else if (command === 'backfill') {
    requireLive();
    git(['fetch', '--quiet', 'origin', 'main']);
    const done = new Set((await recorded()).filter((r) => r.capture_state === 'captured').map((r) => r.commit_sha));
    const shas = git(['rev-list', '--first-parent', '--reverse', 'origin/main']).split('\n').filter(Boolean);
    let failed = 0;
    for (const sha of shas) {
      if (done.has(sha)) continue;
      const row = await capture(sha);
      if (row.capture_state === 'failed') failed += 1;
    }
    console.log(`backfill: ${shas.length} change(s) on main; ${failed} failed (each with its reason above).`);
    process.exit(0);
  } else if (command === 'missing') {
    requireLive();
    git(['fetch', '--quiet', 'origin', 'main']);
    const shas = git(['rev-list', '--first-parent', '--reverse', 'origin/main']).split('\n').filter(Boolean);
    const todo = missingShas(shas, await recorded());
    let failed = 0;
    for (const sha of todo) {
      if (stopping) throw new Stopped(`stopped before ${sha.slice(0, 7)}`);
      const row = await capture(sha);
      if (row.capture_state === 'failed') {
        failed += 1;
        tellTicket(row);
      }
    }
    console.log(todo.length
      ? `missing: captured ${todo.length} change(s) that had no row; ${failed} failed (each with its reason above).`
      : `missing: all ${shas.length} change(s) on main already have a row; nothing to capture.`);
    process.exit(0);
  } else if (command === 'words') {
    requireLive();
    const todo = (await recorded()).filter((r) => r.prompt == null);
    let filled = 0, none = 0, unread = 0;
    for (const r of todo) {
      const words = ticketWords(r.ticket_url);
      if (!words) { unread += 1; continue; }
      if (!words.prompt) { none += 1; continue; }
      const saved = await live(`/rest/v1/evolution_entries?commit_sha=eq.${r.commit_sha}&prompt=is.null`, {
        method: 'PATCH', body: { prompt: words.prompt, thread_url: words.threadUrl }, headers: { Prefer: 'return=representation' },
      });
      if (saved.status >= 300 || !Array.isArray(saved.json) || saved.json[0]?.prompt !== words.prompt) {
        throw new RunFailed(`saving Dane's words for ${r.commit_sha.slice(0, 7)} failed: HTTP ${saved.status} ${JSON.stringify(saved.json)}`);
      }
      filled += 1;
      console.log(`${r.commit_sha.slice(0, 7)} ${r.title}\n  his words: ${words.prompt.split('\n')[0]}`);
    }
    console.log(`words: ${todo.length} change(s) had none; filled ${filled}, ${none} with none of Dane's words on their ticket, ${unread} whose ticket could not be read.`);
    process.exit(unread ? 1 : 0);
  } else if (command === 'list') {
    requireLive();
    const rows = await recorded();
    for (const row of rows) console.log(listLine(row));
    console.log(rows.length ? `${rows.length} change(s) recorded.` : 'No changes recorded yet: run `npm run evolution -- backfill`.');
    process.exit(0);
  } else {
    console.error('usage: npm run evolution -- capture <sha> [--dry-run <file.png>] | backfill | missing | words | list');
    process.exit(1);
  }
} catch (err) {
  if (err instanceof Stopped || stopping) {
    console.error(`evolution STOPPED at the time limit — ${err instanceof Stopped ? err.message : `part-way through, and then: ${err.message}`}. The next pass picks it up again.`);
    process.exit(143);
  }
  if (!(err instanceof RunFailed)) throw err;
  console.error(`evolution FAILED — ${err.message}`);
  process.exit(1);
}
