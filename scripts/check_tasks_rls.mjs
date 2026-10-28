#!/usr/bin/env node
/**
 * Prove, through the real Supabase API, that every member can read every
 * task and attached file but cannot change or delete another member's tasks
 * (row-level security on `public.tasks`), settings, or attached files
 * (`public.task_files` and the private `task-files` bucket); that members
 * vote on any task, only ever through their own vote, and the average becomes
 * the task's points and priority (`public.task_votes`); and that the game
 * layer scores every change while letting each member read only their own
 * engagements and nobody write them (`public.engagements`).
 *
 * It makes two throwaway users, signs each in the way the browser will (the
 * public key plus a password), has each write one task, then checks what each
 * can read, change and delete. The users, their tasks and their stored files
 * are deleted at the end, pass or fail.
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
import { attachFile, filePath, removeFile } from '../core/files.ts';
import { createTask, deleteTask, updateTask } from '../core/tasks.ts';
import { castVote } from '../core/votes.ts';
import { restTaskStore, TOOL_HEADER } from './lib/restTaskStore.mjs';

const TOOL = 'check-tasks-rls';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error('check_tasks_rls: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set (run it under doppler run).');
  process.exit(1);
}

async function call(path, { method = 'GET', key = ANON, token, body, prefer, tool } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${token ?? key}`;
  if (prefer) headers.Prefer = prefer;
  if (tool) headers[TOOL_HEADER] = tool;
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
  return { tag, id: made.json.id, token, store: restTaskStore({ url: URL_, apiKey: ANON, token, ownerId: made.json.id }) };
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

const BUCKET = 'task-files';

/** A TaskFileStore (core/files.ts) over REST, acting as one member. */
function fileStore(member) {
  const fromRow = (r) => r && {
    id: r.id, taskId: r.task_id, ownerId: r.owner_id, path: r.path, name: r.name,
    contentType: r.content_type, sizeBytes: r.size_bytes, tool: r.tool, createdAt: r.created_at,
  };
  return {
    async insert(row) {
      const got = await call('/rest/v1/task_files', {
        method: 'POST', token: member.token, prefer: 'return=representation',
        body: { task_id: row.taskId, path: row.path, name: row.name, content_type: row.contentType, size_bytes: row.sizeBytes, tool: row.tool },
      });
      if (got.status >= 300) throw new Error(`task_files insert failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json[0]);
    },
    async get(id) {
      return fromRow((await call(`/rest/v1/task_files?id=eq.${id}&owner_id=eq.${member.id}`, { token: member.token })).json?.[0]) ?? null;
    },
    async listForTask(taskId) {
      return ((await call(`/rest/v1/task_files?task_id=eq.${taskId}&order=created_at`, { token: member.token })).json ?? []).map(fromRow);
    },
    async remove(id, tool) {
      const got = await call(`/rest/v1/task_files?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool });
      return Array.isArray(got.json) && got.json.length > 0;
    },
    async deleteObjects(paths) {
      const got = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: member.token, body: { prefixes: paths } });
      if (got.status >= 300) throw new Error(`storage delete failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    },
  };
}

/** Upload a file the way the browser does: a one-time signed link asked for as `member`, then a keyless PUT. */
async function upload(member, path, text) {
  const signed = await call(`/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', token: member.token, body: {} });
  if (signed.status >= 300) return { status: signed.status, json: signed.json };
  const res = await fetch(`${URL_}/storage/v1${signed.json.url}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: text });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A VoteStore (core/votes.ts) over REST, acting as one member. */
function voteStore(member) {
  const fromRow = (r) => r && {
    taskId: r.task_id, memberId: r.member_id, points: r.points, priority: r.priority, tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  return {
    async mine(taskId) {
      return fromRow((await call(`/rest/v1/task_votes?task_id=eq.${taskId}&member_id=eq.${member.id}`, { token: member.token })).json?.[0]) ?? null;
    },
    async forTask(taskId) {
      return ((await call(`/rest/v1/task_votes?task_id=eq.${taskId}`, { token: member.token })).json ?? []).map(fromRow);
    },
    async save(row) {
      const got = await call('/rest/v1/task_votes?on_conflict=task_id,member_id', {
        method: 'POST', token: member.token, prefer: 'resolution=merge-duplicates,return=representation',
        body: { task_id: row.taskId, member_id: member.id, points: row.points, priority: row.priority, tool: row.tool },
      });
      if (got.status >= 300) throw new Error(`task_votes save failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json[0]);
    },
    async remove(taskId, tool) {
      const got = await call(`/rest/v1/task_votes?task_id=eq.${taskId}&member_id=eq.${member.id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool });
      return Array.isArray(got.json) && got.json.length > 0;
    },
  };
}

const storedPaths = [];

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

  // Every member reads every task (Dane, 2026-10-27), so each test member
  // also sees the real members' tasks; only the two test tasks are checked.
  const both = `id=in.(${insA.id},${taskB})&select=title,owner_id`;
  const readA = await call(`/rest/v1/tasks?${both}`, { token: a.token });
  const readB = await call(`/rest/v1/tasks?${both}`, { token: b.token });
  const everyA = await call('/rest/v1/tasks?select=id', { token: a.token });
  const everyAll = await admin('/rest/v1/tasks?select=id');
  check('A sees both A’s task and B’s', readA.status === 200 && readA.json.length === 2, `sees ${JSON.stringify(titles(readA.json))}`);
  check('B sees both A’s task and B’s', readB.status === 200 && readB.json.length === 2, `sees ${JSON.stringify(titles(readB.json))}`);
  check('a member sees every task there is', everyA.json?.length === everyAll.json?.length, `A sees ${everyA.json?.length} of ${everyAll.json?.length}`);

  const byId = await call(`/rest/v1/tasks?id=eq.${taskB}&select=title,notes`, { token: a.token });
  check('A can read B’s task by its id', byId.status === 200 && byId.json.length === 1, `HTTP ${byId.status}, rows ${JSON.stringify(byId.json)}`);

  let mayParent = '';
  try { await createTask(a.store, { title: 'A hangs under B', parentTaskId: taskB }, TOOL); } catch (err) { mayParent = err.message; }
  check('A still cannot put a sub-task under B’s task through core', /No task .* you may put a sub-task under/.test(mayParent), mayParent || 'the sub-task was added');

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

  // Points are never below zero, even written straight to the table past core.
  const negative = await call(`/rest/v1/tasks?id=eq.${taskB}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { points: -1 } });
  const afterNegative = await admin(`/rest/v1/tasks?id=eq.${taskB}&select=points`);
  check('the table refuses negative points, even from the task’s owner', negative.status >= 400 && afterNegative.json?.[0]?.points === 5,
    `HTTP ${negative.status} ${negative.json?.message ?? ''}, points now ${afterNegative.json?.[0]?.points}`);

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

  // task_files and the task-files bucket: a member's attached files are their own.
  const pathA = filePath(a.id, insA.id, randomUUID(), 'a-logo.txt');
  storedPaths.push(pathA);
  const upA = await upload(a, pathA, 'A’s file');
  check('A can upload a file into A’s own folder with a one-time link', upA.status === 200, `HTTP ${upA.status} ${JSON.stringify(upA.json)}`);
  const fileA = await attachFile(a.store, fileStore(a), { taskId: insA.id, path: pathA, name: 'a-logo.txt', contentType: 'text/plain', sizeBytes: 8 }, TOOL);
  check('A can attach it to A’s task through core', fileA.ownerId === a.id && fileA.tool === TOOL, JSON.stringify(fileA));

  const filesB = await call(`/rest/v1/task_files?id=eq.${fileA.id}&select=name`, { token: b.token });
  check('B can see A’s file row', filesB.status === 200 && filesB.json.length === 1, `sees ${JSON.stringify(filesB.json)}`);

  const readObj = await call(`/storage/v1/object/authenticated/${BUCKET}/${pathA}`, { token: b.token });
  check('B can read A’s stored file', readObj.status === 200, `HTTP ${readObj.status}`);

  const signObj = await call(`/storage/v1/object/sign/${BUCKET}/${pathA}`, { method: 'POST', token: b.token, body: { expiresIn: 60 } });
  check('B can get a link to A’s stored file', signObj.status === 200, `HTTP ${signObj.status} ${JSON.stringify(signObj.json)}`);

  const anonObj = await call(`/storage/v1/object/public/${BUCKET}/${pathA}`);
  check('the bucket is private: no public link works', anonObj.status >= 400, `HTTP ${anonObj.status}`);

  const intoA = filePath(a.id, insA.id, randomUUID(), 'b-sneaks-in.txt');
  storedPaths.push(intoA);
  const upB = await upload(b, intoA, 'B’s file');
  check('B cannot upload into A’s folder', upB.status >= 400, `HTTP ${upB.status} ${JSON.stringify(upB.json)}`);

  const delObj = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: b.token, body: { prefixes: [pathA] } });
  check('B cannot delete A’s stored file', Array.isArray(delObj.json) && delObj.json.length === 0, `HTTP ${delObj.status} ${JSON.stringify(delObj.json)}`);

  const delRow = await call(`/rest/v1/task_files?id=eq.${fileA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('B cannot delete A’s file row', delRow.status === 200 && delRow.json.length === 0, `HTTP ${delRow.status} ${JSON.stringify(delRow.json)}`);

  const pathB = filePath(b.id, insA.id, randomUUID(), 'b.txt');
  const forgeFile = await call('/rest/v1/task_files', { method: 'POST', token: b.token, body: { task_id: insA.id, path: pathB, name: 'b.txt', size_bytes: 1 } });
  check('B cannot attach a file to A’s task', forgeFile.status >= 400, `HTTP ${forgeFile.status} ${forgeFile.json?.message ?? ''}`);

  const forgeOwner = await call('/rest/v1/task_files', { method: 'POST', token: b.token, body: { task_id: insA.id, owner_id: a.id, path: pathA, name: 'x', size_bytes: 1 } });
  check('B cannot add a file row in A’s name', forgeOwner.status >= 400, `HTTP ${forgeOwner.status} ${forgeOwner.json?.message ?? ''}`);

  let refusedFile = '';
  try { await removeFile(fileStore(b), fileA.id, TOOL); } catch (err) { refusedFile = err.message; }
  check('B cannot remove A’s file through core either', /No file .* you may remove/.test(refusedFile), refusedFile || 'the remove went through');

  const anonFiles = await call('/rest/v1/task_files?select=name');
  check('a signed-out visitor sees no file rows', anonFiles.status >= 400 || (Array.isArray(anonFiles.json) && anonFiles.json.length === 0), `HTTP ${anonFiles.status}`);

  const stillThere = await call(`/storage/v1/object/authenticated/${BUCKET}/${pathA}`, { token: a.token });
  check('A can still read A’s own file afterwards', stillThere.status === 200, `HTTP ${stillThere.status}`);

  await removeFile(fileStore(a), fileA.id, TOOL);
  // Look in the folder listing, not at the file itself: storage may serve a
  // just-read file from its cache for a short while after it is deleted.
  const folder = await admin(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', body: { prefix: `${a.id}/${insA.id}/` } });
  const goneRow = await admin(`/rest/v1/task_files?id=eq.${fileA.id}&select=id`);
  const left = Array.isArray(folder.json) ? folder.json.map((o) => o.name) : folder.json;
  check('A can remove A’s own file through core: the stored copy and the row both go', Array.isArray(left) && left.length === 0 && goneRow.json?.length === 0, `left in the folder ${JSON.stringify(left)}, rows ${JSON.stringify(goneRow.json)}`);

  // The game layer: every change above was scored by the database, each
  // member sees only their own engagements, and nobody can write the ledger.
  const parent = await createTask(a.store, { title: 'A’s plan' }, TOOL);
  await createTask(a.store, { title: 'A’s step', parentTaskId: parent.id }, TOOL);
  await deleteTask(a.store, parent.id, 'rls-check-deleter');

  const ledgerA = await call('/rest/v1/engagements?select=member_id,kind,points,tool,task_id&order=created_at', { token: a.token });
  const kindsA = Array.isArray(ledgerA.json) ? ledgerA.json.map((e) => e.kind) : ledgerA.json;
  console.log(`\nA's engagements, oldest first: ${JSON.stringify(kindsA)}`);
  const expected = ['made_task', 'finished_task', 'switched_agents', 'attached_file', 'removed_file', 'made_task', 'made_task', 'deleted_task'];
  check('every change A made was recorded and scored, once each, in order', JSON.stringify(kindsA) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}`);
  check('every one of A’s engagements is credited to A and names its tool', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.member_id === a.id && e.tool),
    JSON.stringify(ledgerA.json));
  check('finishing a task is worth 5 and the rest 1, from the rules', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.points === (e.kind === 'finished_task' ? 5 : 1)),
    JSON.stringify(ledgerA.json?.map?.((e) => [e.kind, e.points])));
  const deleted = Array.isArray(ledgerA.json) ? ledgerA.json.find((e) => e.kind === 'deleted_task') : null;
  check('a delete names the tool that deleted, and its task', deleted?.tool === 'rls-check-deleter' && deleted?.task_id === parent.id, JSON.stringify(deleted));

  const totalA = await call(`/rest/v1/engagement_totals?member_id=eq.${a.id}&select=points`, { token: a.token });
  check('A’s points total adds up A’s engagements', totalA.json?.[0]?.points === 12, `total ${JSON.stringify(totalA.json)}`);

  const ledgerB = await call(`/rest/v1/engagements?member_id=eq.${a.id}&select=kind`, { token: b.token });
  check('B cannot read A’s engagements', ledgerB.status === 200 && ledgerB.json.length === 0, `sees ${JSON.stringify(ledgerB.json)}`);
  const totalB = await call(`/rest/v1/engagement_totals?member_id=eq.${a.id}&select=points`, { token: b.token });
  check('B cannot read A’s points total', totalB.status === 200 && totalB.json.length === 0, `sees ${JSON.stringify(totalB.json)}`);

  const forgeEng = await call('/rest/v1/engagements', { method: 'POST', token: a.token, body: { member_id: a.id, kind: 'finished_task', points: 1000, tool: 'forged' } });
  check('A cannot write an engagement, even A’s own', forgeEng.status >= 400, `HTTP ${forgeEng.status} ${forgeEng.json?.message ?? ''}`);
  const bumpEng = await call(`/rest/v1/engagements?member_id=eq.${a.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: 1000 } });
  check('A cannot change A’s own engagements', bumpEng.status >= 400 || (Array.isArray(bumpEng.json) && bumpEng.json.length === 0), `HTTP ${bumpEng.status} ${JSON.stringify(bumpEng.json)}`);
  const wipeEng = await call(`/rest/v1/engagements?member_id=eq.${a.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('A cannot delete A’s own engagements', wipeEng.status >= 400 || (Array.isArray(wipeEng.json) && wipeEng.json.length === 0), `HTTP ${wipeEng.status} ${JSON.stringify(wipeEng.json)}`);
  const callRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: a.token, body: { p_member: a.id, p_kind: 'finished_task', p_tool: 'forged', p_task: null } });
  check('A cannot call the ledger’s own write function', callRecord.status >= 400, `HTTP ${callRecord.status} ${callRecord.json?.message ?? ''}`);
  const bumpRule = await call('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: 1000 } });
  check('A cannot change what an engagement is worth', bumpRule.status >= 400 || (Array.isArray(bumpRule.json) && bumpRule.json.length === 0), `HTTP ${bumpRule.status} ${JSON.stringify(bumpRule.json)}`);

  const rulesA = await call('/rest/v1/game_scoring_rules?select=kind,points', { token: a.token });
  const ruleKinds = Array.isArray(rulesA.json) ? rulesA.json.map((r) => r.kind) : [];
  check('a member can read the scoring rules, voting among them', rulesA.status === 200 && ruleKinds.includes('made_task') && ruleKinds.includes('voted_on_task'), `HTTP ${rulesA.status} ${JSON.stringify(rulesA.json)}`);
  const anonEng = await call('/rest/v1/engagements?select=kind');
  const anonRules = await call('/rest/v1/game_scoring_rules?select=kind');
  check('a signed-out visitor sees no engagements and no rules', [anonEng, anonRules].every((r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0)), `HTTP ${anonEng.status} / ${anonRules.status}`);

  // task_votes: any member votes on any task, only ever through their own
  // vote, and the database makes the average the task's points and priority.
  const taskOf = async (id) => (await admin(`/rest/v1/tasks?id=eq.${id}&select=points,priority`)).json?.[0];
  await castVote(voteStore(a), taskB, { points: 8, priority: 'high' }, TOOL);
  let shown = await taskOf(taskB);
  check('A can vote on B’s task, and one vote becomes its points and priority', shown?.points === 8 && shown?.priority === 'high', JSON.stringify(shown));
  await castVote(voteStore(b), taskB, { points: 4, priority: 'low' }, TOOL);
  shown = await taskOf(taskB);
  check('two votes average: 8 and 4 make 6 points, High and Low make Normal', shown?.points === 6 && shown?.priority === 'normal', JSON.stringify(shown));

  const votesSeen = await call(`/rest/v1/task_votes?task_id=eq.${taskB}&select=member_id,points`, { token: a.token });
  check('A can read every vote on B’s task', votesSeen.status === 200 && votesSeen.json.length === 2, JSON.stringify(votesSeen.json));

  const bumpVote = await call(`/rest/v1/task_votes?task_id=eq.${taskB}&member_id=eq.${b.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: 1000 } });
  check('A cannot change B’s vote', bumpVote.status === 200 && bumpVote.json.length === 0, `HTTP ${bumpVote.status} ${JSON.stringify(bumpVote.json)}`);
  const wipeVote = await call(`/rest/v1/task_votes?task_id=eq.${taskB}&member_id=eq.${b.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('A cannot withdraw B’s vote', wipeVote.status === 200 && wipeVote.json.length === 0, `HTTP ${wipeVote.status} ${JSON.stringify(wipeVote.json)}`);
  const forgeVote = await call('/rest/v1/task_votes', { method: 'POST', token: a.token, body: { task_id: insA.id, member_id: b.id, points: 1 } });
  check('A cannot vote in B’s name', forgeVote.status >= 400, `HTTP ${forgeVote.status} ${forgeVote.json?.message ?? ''}`);
  const negVote = await call(`/rest/v1/task_votes?task_id=eq.${taskB}&member_id=eq.${a.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: -1 } });
  check('the table refuses a negative points vote', negVote.status >= 400, `HTTP ${negVote.status} ${negVote.json?.message ?? ''}`);
  const anonVotes = await call('/rest/v1/task_votes?select=points');
  check('a signed-out visitor sees no votes', anonVotes.status >= 400 || (Array.isArray(anonVotes.json) && anonVotes.json.length === 0), `HTTP ${anonVotes.status}`);
  shown = await taskOf(taskB);
  check('B’s task is still at the average afterwards', shown?.points === 6 && shown?.priority === 'normal', JSON.stringify(shown));

  await castVote(voteStore(b), taskB, { points: null, priority: null }, TOOL);
  shown = await taskOf(taskB);
  check('B can withdraw B’s own vote, and the average is A’s alone again', shown?.points === 8 && shown?.priority === 'high', JSON.stringify(shown));

  await castVote(voteStore(a), insA.id, { points: 50 }, TOOL);
  shown = await taskOf(insA.id);
  check('a vote on a done task is kept but its points stay locked', shown?.points === 3 && (await voteStore(a).mine(insA.id))?.points === 50, JSON.stringify(shown));

  const votedA = await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.voted_on_task&select=task_id`, { token: a.token });
  const votedB = await call(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.voted_on_task&select=task_id`, { token: b.token });
  const bChanged = await call(`/rest/v1/engagements?member_id=eq.${b.id}&task_id=eq.${taskB}&kind=eq.changed_task&select=kind`, { token: b.token });
  check('every vote is scored once, for the voter', votedA.json?.length === 2 && votedB.json?.length === 2, `A ${JSON.stringify(votedA.json)}, B ${JSON.stringify(votedB.json)}`);
  check('the average landing on B’s task is not scored as B changing it', bChanged.json?.length === 0, JSON.stringify(bChanged.json));
} catch (err) {
  failures += 1;
  console.error(`check_tasks_rls broke: ${err.message}`);
} finally {
  // Deleting a user does not delete their stored files, so clear them first.
  if (storedPaths.length) {
    const cleared = await admin(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: storedPaths } });
    if (cleared.status >= 300) {
      failures += 1;
      console.error(`could not delete the test files ${storedPaths.join(', ')}: HTTP ${cleared.status} — delete them by hand in the Supabase dashboard`);
    }
  }
  for (const id of users) {
    const gone = await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    if (gone.status >= 300) {
      failures += 1;
      console.error(`could not delete test user ${id}: HTTP ${gone.status} — delete it by hand in the Supabase dashboard`);
    }
  }
  console.log(`\n${users.length} test user(s), their tasks and their files deleted.`);
}

console.log(failures ? `\ncheck_tasks_rls: ${failures} check(s) FAILED.` : '\ncheck_tasks_rls: every check held.');
process.exit(failures ? 1 : 0);
