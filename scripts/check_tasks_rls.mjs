#!/usr/bin/env node
/**
 * Prove, through the real Supabase API, that one member cannot see or change
 * another member's tasks (row-level security on `public.tasks`).
 *
 * It makes two throwaway users, signs each in the way the browser will (the
 * public key plus a password), has each write one task, then checks what each
 * can read, change and delete. The users and their tasks are deleted at the
 * end, pass or fail.
 *
 * Run it with the keys from Doppler:
 *   doppler run --project wavecenter --config dev -- node scripts/check_tasks_rls.mjs
 *
 * Members' own writes go through core/ (createTask, updateTask), the same path
 * every tool uses. The attacks (changing or forging someone else's task) go
 * straight to the table on purpose: they play a hostile client that ignores
 * core, which is exactly what row-level security must stop.
 *
 * Exit 0 = every check held. Exit 1 = a check failed or the run broke.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { setAgentsOn } from '../core/agents.ts';
import { createTask, updateTask } from '../core/tasks.ts';
import { restTaskStore } from './lib/restTaskStore.mjs';

const TOOL = 'check-tasks-rls';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error('check_tasks_rls: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set (run it under doppler run).');
  process.exit(1);
}

async function call(path, { method = 'GET', key = ANON, token, body, prefer } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${token ?? key}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL_}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const admin = (path, opts = {}) => call(path, { ...opts, key: SERVICE });

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
}

const users = [];
async function makeUser(tag) {
  const email = `rls-check-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const made = await admin('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
  if (made.status >= 300) throw new Error(`could not create test user ${tag}: HTTP ${made.status} ${JSON.stringify(made.json)}`);
  users.push(made.json.id);
  const signin = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (signin.status >= 300) throw new Error(`could not sign in test user ${tag}: HTTP ${signin.status} ${JSON.stringify(signin.json)}`);
  const token = signin.json.access_token;
  return { tag, id: made.json.id, token, store: restTaskStore({ url: URL_, apiKey: ANON, token }) };
}

/** A MemberSettingsStore (core/agents.ts) over REST, acting as one member. */
function settingsStore(member) {
  return {
    async get() {
      const got = await call(`/rest/v1/member_settings?owner_id=eq.${member.id}&select=agents_on,tool`, { token: member.token });
      return got.json?.[0] ? { agentsOn: got.json[0].agents_on, tool: got.json[0].tool } : null;
    },
    async save({ agentsOn, tool }) {
      const saved = await call('/rest/v1/member_settings?on_conflict=owner_id', {
        method: 'POST', token: member.token, prefer: 'resolution=merge-duplicates,return=representation',
        body: { owner_id: member.id, agents_on: agentsOn, tool },
      });
      if (saved.status >= 300) throw new Error(`member_settings save failed: HTTP ${saved.status} ${JSON.stringify(saved.json)}`);
      return saved.json?.[0] ? { agentsOn: saved.json[0].agents_on, tool: saved.json[0].tool } : null;
    },
  };
}

const titles = (rows) => (Array.isArray(rows) ? rows.map((r) => r.title) : rows);

try {
  const a = await makeUser('a');
  const b = await makeUser('b');
  console.log(`two test users made and signed in: A=${a.id}  B=${b.id}\n`);

  const insA = await createTask(a.store, { title: 'A’s task', points: 3 }, TOOL);
  const insB = await createTask(b.store, { title: 'B’s task', points: 5 }, TOOL);
  check('A can add a task through core', insA.ownerId === a.id && insA.tool === TOOL, `owner ${insA.ownerId}, tool ${insA.tool}`);
  check('B can add a task through core', insB.ownerId === b.id && insB.tool === TOOL, `owner ${insB.ownerId}, tool ${insB.tool}`);
  const taskB = insB.id;

  const readA = await call('/rest/v1/tasks?select=title,owner_id,status,points', { token: a.token });
  const readB = await call('/rest/v1/tasks?select=title,owner_id,status,points', { token: b.token });
  console.log(`\nA reads every task it can see:\n${JSON.stringify(readA.json, null, 2)}`);
  console.log(`B reads every task it can see:\n${JSON.stringify(readB.json, null, 2)}\n`);
  check('A sees only A’s task', readA.status === 200 && readA.json.length === 1 && readA.json[0].owner_id === a.id, `sees ${JSON.stringify(titles(readA.json))}`);
  check('B sees only B’s task', readB.status === 200 && readB.json.length === 1 && readB.json[0].owner_id === b.id, `sees ${JSON.stringify(titles(readB.json))}`);

  const byId = await call(`/rest/v1/tasks?id=eq.${taskB}&select=title`, { token: a.token });
  check('A cannot read B’s task even by its id', byId.status === 200 && byId.json.length === 0, `HTTP ${byId.status}, rows ${JSON.stringify(byId.json)}`);

  const upd = await call(`/rest/v1/tasks?id=eq.${taskB}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: 999 } });
  check('A cannot change B’s task', upd.status === 200 && upd.json.length === 0, `HTTP ${upd.status}, rows changed ${Array.isArray(upd.json) ? upd.json.length : JSON.stringify(upd.json)}`);

  const del = await call(`/rest/v1/tasks?id=eq.${taskB}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('A cannot delete B’s task', del.status === 200 && del.json.length === 0, `HTTP ${del.status}, rows deleted ${Array.isArray(del.json) ? del.json.length : JSON.stringify(del.json)}`);

  const forge = await call('/rest/v1/tasks', { method: 'POST', token: a.token, body: { title: 'forged', owner_id: b.id } });
  check('A cannot add a task in B’s name', forge.status >= 400, `HTTP ${forge.status} ${forge.json?.message ?? ''}`);

  const anon = await call('/rest/v1/tasks?select=title');
  check('a signed-out visitor sees no tasks', anon.status >= 400 || (Array.isArray(anon.json) && anon.json.length === 0), `HTTP ${anon.status} ${anon.json?.message ?? JSON.stringify(anon.json)}`);

  const row = await updateTask(a.store, insA.id, { status: 'done' }, TOOL);
  check('A can finish A’s own task through core, and it is stamped done', row.status === 'done' && !!row.completedAt && row.updatedAt >= row.createdAt, `completed_at ${row.completedAt}`);

  let refused = '';
  try { await updateTask(b.store, insA.id, { title: 'taken over' }, TOOL); } catch (err) { refused = err.message; }
  check('B cannot change A’s task through core either', /No task .* you may change/.test(refused), refused || 'the change went through');

  const still = await admin(`/rest/v1/tasks?id=eq.${taskB}&select=points`);
  check('B’s task is untouched afterwards', still.json?.[0]?.points === 5, `points ${still.json?.[0]?.points}`);

  // member_settings: the "Launch AI Agents" switch is the member's own.
  const onA = await setAgentsOn(settingsStore(a), true, TOOL);
  await setAgentsOn(settingsStore(b), false, TOOL);
  check('A can turn A’s own AI agents switch on through core', onA.agentsOn === true && onA.tool === TOOL, JSON.stringify(onA));

  const setB = await call('/rest/v1/member_settings?select=owner_id,agents_on', { token: b.token });
  check('B sees only B’s own settings', setB.status === 200 && setB.json.length === 1 && setB.json[0].owner_id === b.id, `sees ${JSON.stringify(setB.json)}`);

  const flip = await call(`/rest/v1/member_settings?owner_id=eq.${a.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { agents_on: false } });
  check('B cannot turn A’s switch off', flip.status === 200 && flip.json.length === 0, `HTTP ${flip.status}, rows changed ${Array.isArray(flip.json) ? flip.json.length : JSON.stringify(flip.json)}`);

  const forgeSet = await call('/rest/v1/member_settings', { method: 'POST', token: b.token, body: { owner_id: a.id, agents_on: false } });
  check('B cannot write settings in A’s name', forgeSet.status >= 400, `HTTP ${forgeSet.status} ${forgeSet.json?.message ?? ''}`);

  const anonSet = await call('/rest/v1/member_settings?select=owner_id');
  check('a signed-out visitor sees no settings', anonSet.status >= 400 || (Array.isArray(anonSet.json) && anonSet.json.length === 0), `HTTP ${anonSet.status} ${anonSet.json?.message ?? JSON.stringify(anonSet.json)}`);

  const stillOn = await admin(`/rest/v1/member_settings?owner_id=eq.${a.id}&select=agents_on`);
  check('A’s switch is still on afterwards', stillOn.json?.[0]?.agents_on === true, `agents_on ${stillOn.json?.[0]?.agents_on}`);
} catch (err) {
  failures += 1;
  console.error(`check_tasks_rls broke: ${err.message}`);
} finally {
  for (const id of users) {
    const gone = await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    if (gone.status >= 300) {
      failures += 1;
      console.error(`could not delete test user ${id}: HTTP ${gone.status} — delete it by hand in the Supabase dashboard`);
    }
  }
  console.log(`\n${users.length} test user(s) and their tasks deleted.`);
}

console.log(failures ? `\ncheck_tasks_rls: ${failures} check(s) FAILED.` : '\ncheck_tasks_rls: every check held.');
process.exit(failures ? 1 : 0);
