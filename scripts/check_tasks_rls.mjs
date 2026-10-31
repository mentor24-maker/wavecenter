#!/usr/bin/env node
/**
 * Prove, through the real Supabase API, that every member can read every
 * task and attached file but cannot change or delete another member's tasks
 * (row-level security on `public.tasks`), settings, profile
 * (`public.member_profiles`), or attached files (`public.task_files` and the
 * private `task-files` bucket); that a member cannot see or change another
 * member's Discussion comments (`public.task_comments`) or the files attached
 * to them; that members vote on
 * any task, only ever through their own vote, and the average becomes the
 * task's points and priority (`public.task_votes`); that every member reads
 * the roles and permissions lists but nobody writes them, a member reads only
 * their own role row, every member lists the members, and only an admin
 * changes a role
 * (`public.member_roles`); that every member reads the teams and their
 * members (each shown only as their profile allows) but only an admin or an
 * editor changes them (`public.teams`, `public.team_members`); that a task
 * added by anyone but an admin is Proposed, stays so, never goes to AI agents,
 * and only an admin approves it (`approve_task`); and that the game layer
 * scores every change while letting each member read only their own
 * engagements and nobody write them (`public.engagements`); that only an
 * admin changes a scoring rule or adds an action, through the database's own
 * functions, with the change counting from the next engagement
 * (`public.game_scoring_rules`); and that every member reads the Evolution
 * rows and screenshots but only the service key writes them
 * (`public.evolution_entries` and the private `evolution` bucket).
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
import { addComment, editComment, removeComment } from '../core/comments.ts';
import { ENGAGEMENT_KINDS, addScoringRule, changeScoringRule } from '../core/game.ts';
import { setMemberRole } from '../core/members.ts';
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, updateTeam } from '../core/teams.ts';
import { loadProfile, saveProfile } from '../core/profiles.ts';
import { attachFile, commentFilePath, deleteTaskWithFiles, filePath, removeCommentWithFiles, removeFile } from '../core/files.ts';
import { approveTask, createTask, deleteTask, updateTask } from '../core/tasks.ts';
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

/** A ScoringRuleStore (core/game.ts) over REST, acting as one member. */
function scoringStore(member) {
  const save = async (fn, kindParam, kind, fields, tool) => {
    const got = await call(`/rest/v1/rpc/${fn}`, {
      method: 'POST', token: member.token,
      body: { [kindParam]: kind, new_name: fields.name, new_description: fields.description, new_criteria: fields.criteria, new_points: fields.points, tool },
    });
    if (got.status >= 300) throw new Error(`${fn} failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    return got.json;
  };
  return {
    async rules() {
      return (await call('/rest/v1/game_scoring_rules?select=*&order=position', { token: member.token })).json ?? [];
    },
    update: (kind, fields, tool) => save('update_scoring_rule', 'rule_kind', kind, fields, tool),
    add: (kind, fields, tool) => save('add_scoring_rule', 'new_kind', kind, fields, tool),
  };
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

/** A MemberProfileStore (core/profiles.ts) over REST, acting as one member. */
function profileStore(member) {
  const fromRow = (r) => r && { displayName: r.display_name, avatar: r.avatar, bio: r.bio, visibility: r.visibility, tool: r.tool };
  return {
    async get() {
      const got = await call(`/rest/v1/member_profiles?owner_id=eq.${member.id}`, { token: member.token });
      if (got.status >= 300) throw new Error(`member_profiles read failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json?.[0]) ?? null;
    },
    async save(p) {
      const saved = await call('/rest/v1/member_profiles?on_conflict=owner_id', {
        method: 'POST', token: member.token, prefer: 'resolution=merge-duplicates,return=representation',
        body: { owner_id: member.id, display_name: p.displayName, avatar: p.avatar, bio: p.bio, visibility: p.visibility, tool: p.tool },
      });
      if (saved.status >= 300) throw new Error(`member_profiles save failed: HTTP ${saved.status} ${JSON.stringify(saved.json)}`);
      return fromRow(saved.json?.[0]) ?? null;
    },
  };
}

const BUCKET = 'task-files';

/** A TaskFileStore (core/files.ts) over REST, acting as one member. */
function fileStore(member) {
  const fromRow = (r) => r && {
    id: r.id, taskId: r.task_id, ownerId: r.owner_id, path: r.path, name: r.name,
    contentType: r.content_type, sizeBytes: r.size_bytes, tool: r.tool, commentId: r.comment_id, createdAt: r.created_at,
  };
  return {
    async insert(row) {
      const got = await call('/rest/v1/task_files', {
        method: 'POST', token: member.token, prefer: 'return=representation',
        body: { task_id: row.taskId, path: row.path, name: row.name, content_type: row.contentType, size_bytes: row.sizeBytes, tool: row.tool, comment_id: row.commentId },
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

/** A TaskCommentStore (core/comments.ts) over REST, acting as one member. */
function commentStore(member) {
  const fromRow = (r) => r && {
    id: r.id, taskId: r.task_id, ownerId: r.owner_id, body: r.body, tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  return {
    async insert(row) {
      const got = await call('/rest/v1/task_comments', {
        method: 'POST', token: member.token, prefer: 'return=representation',
        body: { task_id: row.taskId, body: row.body, tool: row.tool },
      });
      if (got.status >= 300) throw new Error(`task_comments insert failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json[0]);
    },
    async get(id) {
      return fromRow((await call(`/rest/v1/task_comments?id=eq.${id}`, { token: member.token })).json?.[0]) ?? null;
    },
    async update(id, body, tool) {
      const got = await call(`/rest/v1/task_comments?id=eq.${id}`, { method: 'PATCH', token: member.token, prefer: 'return=representation', body: { body, tool } });
      if (got.status >= 300) throw new Error(`task_comments update failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json?.[0]) ?? null;
    },
    async remove(id) {
      const got = await call(`/rest/v1/task_comments?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation' });
      return Array.isArray(got.json) && got.json.length > 0;
    },
  };
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

/** A MemberRoleStore (core/members.ts) over REST, acting as one member. */
function roleStore(member) {
  return {
    async roleOf(memberId) {
      const got = await call(`/rest/v1/member_roles?member_id=eq.${memberId}&select=role`, { token: member.token });
      if (got.status >= 300) throw new Error(`member_roles read failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return got.json?.[0]?.role ?? null;
    },
    async adminCount() {
      const got = await call('/rest/v1/member_roles?role=eq.admin&select=member_id', { token: member.token });
      if (got.status >= 300) throw new Error(`member_roles count failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return got.json.length;
    },
    async setRole(memberId, role, tool) {
      const got = await call('/rest/v1/rpc/set_member_role', { method: 'POST', token: member.token, body: { member: memberId, new_role: role, tool } });
      if (got.status >= 300) throw new Error(`set_member_role failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return got.json;
    },
  };
}

/** A TeamStore (core/teams.ts) over REST, acting as one member. */
function teamStore(member) {
  const fromRow = (r) => r && { id: r.id, name: r.name, slug: r.slug, description: r.description, tool: r.tool, createdAt: r.created_at, createdBy: r.created_by };
  const rows = (got, what) => {
    if (got.status >= 300) throw new Error(`${what} failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    return Array.isArray(got.json) ? got.json : [];
  };
  return {
    async get(id) {
      return fromRow(rows(await call(`/rest/v1/teams?id=eq.${id}`, { token: member.token }), 'teams read')[0]) ?? null;
    },
    async slugInUse(slug, exceptId) {
      const not = exceptId ? `&id=neq.${exceptId}` : '';
      return rows(await call(`/rest/v1/teams?slug=eq.${slug}${not}&select=id`, { token: member.token }), 'teams slug check').length > 0;
    },
    async insert(fields, tool) {
      const got = await call('/rest/v1/teams', { method: 'POST', token: member.token, prefer: 'return=representation', body: { ...fields, tool } });
      const made = fromRow(rows(got, 'teams insert')[0]) ?? null;
      if (made) teamIds.push(made.id);
      return made;
    },
    async update(id, fields, tool) {
      return fromRow(rows(await call(`/rest/v1/teams?id=eq.${id}`, { method: 'PATCH', token: member.token, prefer: 'return=representation', body: { ...fields, tool } }), 'teams update')[0]) ?? null;
    },
    async remove(id) {
      return rows(await call(`/rest/v1/teams?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation' }), 'teams delete').length > 0;
    },
    async hasMember(teamId, memberId) {
      return rows(await call(`/rest/v1/team_members?team_id=eq.${teamId}&member_id=eq.${memberId}&select=member_id`, { token: member.token }), 'team_members read').length > 0;
    },
    async addMember(teamId, memberId, tool) {
      return rows(await call('/rest/v1/team_members', { method: 'POST', token: member.token, prefer: 'return=representation', body: { team_id: teamId, member_id: memberId, tool } }), 'team_members insert').length > 0;
    },
    async removeMember(teamId, memberId) {
      return rows(await call(`/rest/v1/team_members?team_id=eq.${teamId}&member_id=eq.${memberId}`, { method: 'DELETE', token: member.token, prefer: 'return=representation' }), 'team_members delete').length > 0;
    },
  };
}

const storedPaths = [];
const EVO_BUCKET = 'evolution';
const evoSha = randomBytes(20).toString('hex');
const evoPath = `check-tasks-rls-${evoSha}.png`;
// A 1x1 transparent PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const teamIds = [];

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

  // Proposed: A and B are contributors, so their tasks wait for an admin.
  check('a contributor’s new task starts as Proposed', insA.status === 'proposed' && insB.status === 'proposed', `A ${insA.status}, B ${insB.status}`);
  const skip = await call('/rest/v1/tasks', { method: 'POST', token: b.token, prefer: 'return=representation', body: { title: 'B skips the queue', status: 'todo', agent_selected: true } });
  const skipped = skip.json?.[0];
  check('the database files a contributor’s task as Proposed and unticked, whatever the client asks', skip.status < 300 && skipped?.status === 'proposed' && skipped?.agent_selected === false,
    `HTTP ${skip.status} ${JSON.stringify(skipped ?? skip.json)}`);
  const selfApprove = await call(`/rest/v1/tasks?id=eq.${taskB}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { status: 'todo' } });
  check('a contributor cannot take their own task out of Proposed', selfApprove.status >= 400, `HTTP ${selfApprove.status} ${JSON.stringify(selfApprove.json)}`);
  const tickProposed = await call(`/rest/v1/tasks?id=eq.${taskB}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { agent_selected: true } });
  check('a proposed task cannot be ticked for AI agents, even straight at the table', tickProposed.status >= 400, `HTTP ${tickProposed.status} ${JSON.stringify(tickProposed.json)}`);
  let tickRefused = '';
  try { await updateTask(b.store, taskB, { agentSelected: true }, TOOL); } catch (err) { tickRefused = err.message; }
  check('core refuses to tick a proposed task too, in plain words', /until an admin approves it/.test(tickRefused), tickRefused || 'the tick went through');
  const rpcApprove = await call('/rest/v1/rpc/approve_task', { method: 'POST', token: b.token, body: { task: taskB, tool: TOOL } });
  check('a contributor cannot approve a task through the database function', rpcApprove.status >= 400, `HTTP ${rpcApprove.status} ${JSON.stringify(rpcApprove.json)}`);
  const stillProposed = await admin(`/rest/v1/tasks?id=eq.${taskB}&select=status,agent_selected`);
  check('B’s task is still Proposed and unticked afterwards', stillProposed.json?.[0]?.status === 'proposed' && stillProposed.json?.[0]?.agent_selected === false, JSON.stringify(stillProposed.json));
  // Approve A's task with the service key, as an admin would, so A can finish it below.
  const approvedA = await admin(`/rest/v1/tasks?id=eq.${insA.id}`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'todo', tool: TOOL } });
  if (approvedA.status >= 300 || approvedA.json?.[0]?.status !== 'todo') throw new Error(`could not approve A’s task: HTTP ${approvedA.status} ${JSON.stringify(approvedA.json)}`);

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

  // member_profiles: a profile starts anonymous, and is the member's own whatever its visibility.
  const fresh = await loadProfile(profileStore(a));
  check('A’s profile starts anonymous, with no name', fresh.visibility === 'anonymous' && fresh.displayName === null, JSON.stringify(fresh));
  const profA = await saveProfile(profileStore(a), { displayName: 'A', avatar: 'sun', bio: 'A’s bio', visibility: 'public' }, TOOL);
  check('A can save A’s own profile through core', profA.displayName === 'A' && profA.visibility === 'public' && profA.tool === TOOL, JSON.stringify(profA));
  await saveProfile(profileStore(b), { displayName: 'B', avatar: 'moon', bio: null, visibility: 'private' }, TOOL);

  const profB = await call('/rest/v1/member_profiles?select=owner_id,display_name', { token: b.token });
  check('B sees only B’s own profile, even though A’s is public', profB.status === 200 && profB.json.length === 1 && profB.json[0].owner_id === b.id, `sees ${JSON.stringify(profB.json)}`);

  const renameA = await call(`/rest/v1/member_profiles?owner_id=eq.${a.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { display_name: 'hacked' } });
  check('B cannot change A’s profile', renameA.status >= 400 || (Array.isArray(renameA.json) && renameA.json.length === 0), `HTTP ${renameA.status} ${JSON.stringify(renameA.json)}`);

  const forgeProf = await call('/rest/v1/member_profiles', { method: 'POST', token: b.token, body: { owner_id: a.id, display_name: 'forged' } });
  check('B cannot write a profile in A’s name', forgeProf.status >= 400, `HTTP ${forgeProf.status} ${forgeProf.json?.message ?? ''}`);

  const badAvatar = await call('/rest/v1/member_profiles?on_conflict=owner_id', {
    method: 'POST', token: a.token, prefer: 'resolution=merge-duplicates', body: { owner_id: a.id, avatar: 'https://example.com/x.png', visibility: 'everyone' },
  });
  check('the database refuses an avatar or visibility core does not know', badAvatar.status >= 400, `HTTP ${badAvatar.status} ${badAvatar.json?.message ?? ''}`);

  const anonProf = await call('/rest/v1/member_profiles?select=owner_id');
  check('a signed-out visitor sees no profiles', anonProf.status >= 400 || (Array.isArray(anonProf.json) && anonProf.json.length === 0), `HTTP ${anonProf.status} ${anonProf.json?.message ?? JSON.stringify(anonProf.json)}`);

  const stillA = await admin(`/rest/v1/member_profiles?owner_id=eq.${a.id}&select=display_name,avatar`);
  check('A’s profile is unchanged afterwards', stillA.json?.[0]?.display_name === 'A' && stillA.json?.[0]?.avatar === 'sun', JSON.stringify(stillA.json));

  // Roles and permissions: the lists are everyone's to read and nobody's to
  // write; a member reads only their own role row; every member lists the
  // members (View members); only an admin changes a role, and only through
  // set_member_role.
  const rolesB = await call('/rest/v1/roles?select=key&order=position', { token: b.token });
  const permsB = await call('/rest/v1/permissions?select=key', { token: b.token });
  const grantsB = await call('/rest/v1/role_permissions?select=role,permission', { token: b.token });
  check('a member reads the five roles', JSON.stringify(rolesB.json?.map((r) => r.key)) === JSON.stringify(['admin', 'editor', 'contributor', 'reviewer', 'viewer']), JSON.stringify(rolesB.json));
  check('a member reads the permissions and who has which', permsB.json?.length >= 6 && grantsB.json?.length >= 19, `permissions ${permsB.json?.length}, grants ${grantsB.json?.length}`);
  for (const [table, body] of [['roles', { key: 'owner', name: 'Owner', description: 'x', position: 99 }], ['permissions', { key: 'task.own', label: 'x', position: 99 }], ['role_permissions', { role: 'viewer', permission: 'task.delete' }]]) {
    const forged = await call(`/rest/v1/${table}`, { method: 'POST', token: b.token, body });
    check(`a member cannot add to ${table}`, forged.status >= 400, `HTTP ${forged.status} ${forged.json?.message ?? ''}`);
  }
  const wipeGrants = await call('/rest/v1/role_permissions?role=eq.viewer', { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('a member cannot remove a grant', wipeGrants.status >= 400 || (Array.isArray(wipeGrants.json) && wipeGrants.json.length === 0), `HTTP ${wipeGrants.status} ${JSON.stringify(wipeGrants.json)}`);
  const anonRoles = await call('/rest/v1/roles?select=key');
  check('a signed-out visitor sees no roles', anonRoles.status >= 400 || (Array.isArray(anonRoles.json) && anonRoles.json.length === 0), `HTTP ${anonRoles.status}`);

  const selfPromote = await call('/rest/v1/rpc/set_member_role', { method: 'POST', token: b.token, body: { member: b.id, new_role: 'admin', tool: TOOL } });
  check('a contributor cannot make themselves admin', selfPromote.status >= 400, `HTTP ${selfPromote.status} ${selfPromote.json?.message ?? ''}`);
  const forgeRole = await call('/rest/v1/member_roles', { method: 'POST', token: b.token, body: { member_id: b.id, role: 'admin' } });
  check('a member cannot write a role row directly', forgeRole.status >= 400, `HTTP ${forgeRole.status} ${forgeRole.json?.message ?? ''}`);
  const listB = await call('/rest/v1/rpc/list_members', { method: 'POST', token: b.token, body: {} });
  check('a contributor lists the members, with no email in the list', listB.status === 200 && listB.json?.some?.((m) => m.member_id === b.id) && !JSON.stringify(listB.json).includes('@'), `HTTP ${listB.status} ${JSON.stringify(listB.json)?.slice(0, 200)}`);
  const refusedRole = await setMemberRole(roleStore(b), { actorId: b.id, memberId: a.id, role: 'viewer' }, TOOL).then(() => '', (e) => e.message);
  check('a non-admin cannot change a role through core either', /Only an admin/.test(refusedRole), refusedRole || 'the change went through');

  // Make A an admin with the service key, as the migration made Dane one.
  const madeAdmin = await admin('/rest/v1/member_roles', { method: 'POST', body: { member_id: a.id, role: 'admin', tool: TOOL } });
  if (madeAdmin.status >= 300) throw new Error(`could not make A an admin: HTTP ${madeAdmin.status} ${JSON.stringify(madeAdmin.json)}`);
  const peekRole = await call('/rest/v1/rpc/member_role', { method: 'POST', token: b.token, body: { member: a.id } });
  check('a non-admin cannot read another member’s role through a database function', peekRole.status >= 400 || !['admin', 'editor', 'contributor', 'reviewer', 'viewer'].includes(peekRole.json), `HTTP ${peekRole.status} ${JSON.stringify(peekRole.json)}`);
  const peekRow = await call(`/rest/v1/member_roles?member_id=eq.${a.id}&select=role`, { token: b.token });
  check('a non-admin cannot read another member’s role row', Array.isArray(peekRow.json) && peekRow.json.length === 0, `HTTP ${peekRow.status} ${JSON.stringify(peekRow.json)}`);
  const approvedB = await approveTask(a.store, skipped.id, 'admin', TOOL);
  check('an admin approves another member’s proposed task through core, and it becomes todo', approvedB.status === 'todo' && approvedB.ownerId === b.id && approvedB.tool === TOOL, JSON.stringify(approvedB));
  const again = await call('/rest/v1/rpc/approve_task', { method: 'POST', token: a.token, body: { task: skipped.id, tool: TOOL } });
  check('approving a task that is no longer proposed changes nothing', again.status === 200 && Array.isArray(again.json) && again.json.length === 0, `HTTP ${again.status} ${JSON.stringify(again.json)}`);
  const listA = await call('/rest/v1/rpc/list_members', { method: 'POST', token: a.token, body: {} });
  const rowA = listA.json?.find?.((m) => m.member_id === a.id);
  const rowB = listA.json?.find?.((m) => m.member_id === b.id);
  check('an admin lists every member', listA.status === 200 && !!rowA && !!rowB, `HTTP ${listA.status} ${JSON.stringify(listA.json)?.slice(0, 200)}`);
  check('the list shows a public name, hides a private profile, and carries no email', rowA?.display_name === 'A' && rowA?.avatar === 'sun' && rowB?.display_name === null && rowB?.avatar === null && !JSON.stringify(listA.json).includes('@'), `A ${JSON.stringify(rowA)}, B ${JSON.stringify(rowB)}`);
  const noTool = await call('/rest/v1/rpc/set_member_role', { method: 'POST', token: a.token, body: { member: b.id, new_role: 'viewer', tool: ' ' } });
  check('the database refuses a role change with no tool name', noTool.status >= 400, `HTTP ${noTool.status} ${noTool.json?.message ?? ''}`);
  const viewerB = await setMemberRole(roleStore(a), { actorId: a.id, memberId: b.id, role: 'viewer' }, TOOL);
  const ownB = await call('/rest/v1/member_roles?select=member_id,role,tool', { token: b.token });
  check('an admin changes a role through core, and the member reads it', viewerB === 'viewer' && ownB.json?.length === 1 && ownB.json[0].role === 'viewer' && ownB.json[0].tool === TOOL, JSON.stringify(ownB.json));
  const allA = await call('/rest/v1/member_roles?select=member_id', { token: a.token });
  check('an admin reads every role row', allA.json?.some((r) => r.member_id === a.id) && allA.json?.some((r) => r.member_id === b.id), JSON.stringify(allA.json));
  const bumpB = await call(`/rest/v1/member_roles?member_id=eq.${b.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { role: 'admin' } });
  check('a member cannot change their own role row directly', bumpB.status >= 400 || (Array.isArray(bumpB.json) && bumpB.json.length === 0), `HTTP ${bumpB.status} ${JSON.stringify(bumpB.json)}`);
  const anonRoleRows = await call('/rest/v1/member_roles?select=member_id');
  const anonList = await call('/rest/v1/rpc/list_members', { method: 'POST', body: {} });
  check('a signed-out visitor sees no roles and cannot list members', (anonRoleRows.status >= 400 || anonRoleRows.json?.length === 0) && anonList.status >= 400, `rows HTTP ${anonRoleRows.status}, list HTTP ${anonList.status}`);
  const stillViewer = await admin(`/rest/v1/member_roles?member_id=eq.${b.id}&select=role`);
  check('B is still a viewer afterwards', stillViewer.json?.[0]?.role === 'viewer', JSON.stringify(stillViewer.json));

  // Teams: every role reads them and their members; only an admin or an
  // editor (Dane, 2026-10-30, "B") makes, changes or deletes them, through
  // core or straight at the tables. A is an admin and B a viewer by now.
  const teamDeps = (member) => ({ teams: teamStore(member), roles: roleStore(member) });
  const slug = `rls-check-${randomUUID().slice(0, 8)}`;
  const teamA = await createTeam(teamDeps(a), { actorId: a.id, name: 'RLS check team', slug, description: 'Made by check_tasks_rls.' }, TOOL);
  check('an admin makes a team through core, and it names its tool', teamA.slug === slug && teamA.tool === TOOL && teamA.createdBy === a.id, JSON.stringify(teamA));
  const dupSlug = await call('/rest/v1/teams', { method: 'POST', token: a.token, body: { name: 'Again', slug } });
  check('the database refuses a slug already taken', dupSlug.status === 409 || dupSlug.json?.code === '23505', `HTTP ${dupSlug.status} ${dupSlug.json?.message ?? ''}`);
  const badSlug = await call('/rest/v1/teams', { method: 'POST', token: a.token, body: { name: 'Bad', slug: 'Not A Slug' } });
  check('the database refuses a malformed slug', badSlug.status >= 400, `HTTP ${badSlug.status} ${badSlug.json?.message ?? ''}`);
  const forgedMaker = await call('/rest/v1/teams', { method: 'POST', token: a.token, body: { name: 'Forged', slug: `${slug}-x`, created_by: b.id } });
  check('nobody can record someone else as a team’s maker', forgedMaker.status >= 400, `HTTP ${forgedMaker.status} ${forgedMaker.json?.message ?? ''}`);
  await addTeamMember(teamDeps(a), { actorId: a.id, teamId: teamA.id, memberId: a.id }, TOOL);
  await addTeamMember(teamDeps(a), { actorId: a.id, teamId: teamA.id, memberId: b.id }, TOOL);

  const teamsB = await call(`/rest/v1/teams?id=eq.${teamA.id}&select=name`, { token: b.token });
  check('a viewer reads the teams', teamsB.status === 200 && teamsB.json?.length === 1, JSON.stringify(teamsB.json));
  const listTeamB = await call('/rest/v1/rpc/list_team_members', { method: 'POST', token: b.token, body: {} });
  const onTeam = (listTeamB.json ?? []).filter?.((r) => r.team_id === teamA.id) ?? [];
  const tA = onTeam.find((r) => r.member_id === a.id);
  const tB = onTeam.find((r) => r.member_id === b.id);
  check('a viewer lists a team’s members', listTeamB.status === 200 && onTeam.length === 2, `HTTP ${listTeamB.status} ${JSON.stringify(listTeamB.json)?.slice(0, 200)}`);
  check('the team list shows a public name, hides a private profile, and carries no email', tA?.display_name === 'A' && tA?.avatar === 'sun' && tB?.display_name === null && tB?.avatar === null && !JSON.stringify(listTeamB.json).includes('@'), `A ${JSON.stringify(tA)}, B ${JSON.stringify(tB)}`);

  const refusedTeam = await createTeam(teamDeps(b), { actorId: b.id, name: 'Viewer team', slug: `${slug}-v`, description: null }, TOOL).then(() => '', (e) => e.message);
  check('a viewer cannot make a team through core', /Only an admin or an editor/.test(refusedTeam), refusedTeam || 'the team was made');
  const forgedTeam = await call('/rest/v1/teams', { method: 'POST', token: b.token, body: { name: 'Viewer team', slug: `${slug}-v` } });
  check('a viewer cannot make a team straight at the table', forgedTeam.status >= 400, `HTTP ${forgedTeam.status} ${forgedTeam.json?.message ?? ''}`);
  const renameB = await call(`/rest/v1/teams?id=eq.${teamA.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { name: 'Hijacked' } });
  check('a viewer cannot change a team', renameB.status >= 400 || (Array.isArray(renameB.json) && renameB.json.length === 0), `HTTP ${renameB.status} ${JSON.stringify(renameB.json)}`);
  const dropB = await call(`/rest/v1/teams?id=eq.${teamA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('a viewer cannot delete a team', dropB.status >= 400 || (Array.isArray(dropB.json) && dropB.json.length === 0), `HTTP ${dropB.status} ${JSON.stringify(dropB.json)}`);
  const leaveB = await call(`/rest/v1/team_members?team_id=eq.${teamA.id}&member_id=eq.${a.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  const joinB = await call('/rest/v1/team_members', { method: 'POST', token: b.token, body: { team_id: teamA.id, member_id: b.id } });
  check('a viewer cannot change a team’s members', (leaveB.status >= 400 || leaveB.json?.length === 0) && joinB.status >= 400, `remove HTTP ${leaveB.status} ${JSON.stringify(leaveB.json)}, add HTTP ${joinB.status}`);
  const anonTeams = await call('/rest/v1/teams?select=id');
  const anonTeamList = await call('/rest/v1/rpc/list_team_members', { method: 'POST', body: {} });
  check('a signed-out visitor sees no teams and cannot list their members', (anonTeams.status >= 400 || anonTeams.json?.length === 0) && anonTeamList.status >= 400, `teams HTTP ${anonTeams.status}, list HTTP ${anonTeamList.status}`);

  // An editor manages teams too: make B one for a moment.
  await setMemberRole(roleStore(a), { actorId: a.id, memberId: b.id, role: 'editor' }, TOOL);
  const edited = await updateTeam(teamDeps(b), { actorId: b.id, teamId: teamA.id, name: 'RLS check team', slug, description: 'Changed by an editor.' }, TOOL);
  check('an editor changes a team through core', edited.description === 'Changed by an editor.', JSON.stringify(edited));
  await removeTeamMember(teamDeps(b), { actorId: b.id, teamId: teamA.id, memberId: b.id }, TOOL);
  check('an editor removes a member from a team', !(await teamStore(a).hasMember(teamA.id, b.id)), 'B is still on the team');
  await deleteTeam(teamDeps(b), { actorId: b.id, teamId: teamA.id }, TOOL);
  const goneTeam = await admin(`/rest/v1/teams?id=eq.${teamA.id}&select=id`);
  const goneLinks = await admin(`/rest/v1/team_members?team_id=eq.${teamA.id}&select=member_id`);
  const stillA2 = await admin(`/auth/v1/admin/users/${a.id}`);
  check('deleting a team removes its member links and no member account', goneTeam.json?.length === 0 && goneLinks.json?.length === 0 && stillA2.status === 200, `team ${JSON.stringify(goneTeam.json)}, links ${JSON.stringify(goneLinks.json)}, A HTTP ${stillA2.status}`);
  await setMemberRole(roleStore(a), { actorId: a.id, memberId: b.id, role: 'viewer' }, TOOL);

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

  // task_comments: a member's Discussion comments are their own.
  const commentA = await addComment(a.store, commentStore(a), insA.id, 'A’s comment', TOOL);
  check('A can comment on A’s own task through core', commentA.ownerId === a.id && commentA.tool === TOOL, JSON.stringify(commentA));

  const commentsB = await call('/rest/v1/task_comments?select=body', { token: b.token });
  check('B sees none of A’s comments', commentsB.status === 200 && commentsB.json.length === 0, `sees ${JSON.stringify(commentsB.json)}`);

  const editB = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { body: 'taken over' } });
  check('B cannot change A’s comment', editB.status === 200 && editB.json.length === 0, `HTTP ${editB.status} ${JSON.stringify(editB.json)}`);

  const delCommentB = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('B cannot delete A’s comment', delCommentB.status === 200 && delCommentB.json.length === 0, `HTTP ${delCommentB.status} ${JSON.stringify(delCommentB.json)}`);

  const forgeComment = await call('/rest/v1/task_comments', { method: 'POST', token: b.token, body: { task_id: insA.id, body: 'B on A’s task' } });
  check('B cannot comment on A’s task', forgeComment.status >= 400, `HTTP ${forgeComment.status} ${forgeComment.json?.message ?? ''}`);

  const forgeCommentOwner = await call('/rest/v1/task_comments', { method: 'POST', token: b.token, body: { task_id: insA.id, owner_id: a.id, body: 'in A’s name' } });
  check('B cannot add a comment in A’s name', forgeCommentOwner.status >= 400, `HTTP ${forgeCommentOwner.status} ${forgeCommentOwner.json?.message ?? ''}`);

  let refusedComment = '';
  try { await editComment(commentStore(b), commentA.id, 'taken over', TOOL); } catch (err) { refusedComment = err.message; }
  check('B cannot change A’s comment through core either', /No comment .* you may change/.test(refusedComment), refusedComment || 'the change went through');
  refusedComment = '';
  try { await removeComment(commentStore(b), commentA.id, TOOL); } catch (err) { refusedComment = err.message; }
  check('B cannot remove A’s comment through core either', /No comment .* you may remove/.test(refusedComment), refusedComment || 'the remove went through');
  refusedComment = '';
  try { await addComment(b.store, commentStore(b), insA.id, 'B on A’s task', TOOL); } catch (err) { refusedComment = err.message; }
  check('B cannot comment on A’s task through core either', /No task .* you may comment on/.test(refusedComment), refusedComment || 'the comment went through');

  const moveComment = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { task_id: taskB } });
  check('A cannot move A’s comment onto another task', moveComment.status >= 400, `HTTP ${moveComment.status} ${moveComment.json?.message ?? JSON.stringify(moveComment.json)}`);

  const anonComments = await call('/rest/v1/task_comments?select=body');
  check('a signed-out visitor sees no comments', anonComments.status >= 400 || (Array.isArray(anonComments.json) && anonComments.json.length === 0), `HTTP ${anonComments.status}`);

  const editedA = await editComment(commentStore(a), commentA.id, 'A’s comment, edited', TOOL);
  const stillComment = await admin(`/rest/v1/task_comments?id=eq.${commentA.id}&select=body,owner_id,task_id`);
  check('A can edit A’s own comment through core, and only A’s change landed', editedA.body === 'A’s comment, edited' && stillComment.json?.[0]?.task_id === insA.id && stillComment.json?.[0]?.owner_id === a.id,
    JSON.stringify(stillComment.json));

  await removeComment(commentStore(a), commentA.id, TOOL);
  const goneComment = await admin(`/rest/v1/task_comments?id=eq.${commentA.id}&select=id`);
  check('A can remove A’s own comment through core', goneComment.json?.length === 0, JSON.stringify(goneComment.json));

  // A comment's files: as private as the comment, and gone with it.
  const noteA = await addComment(a.store, commentStore(a), insA.id, 'A’s comment with a file', TOOL);
  const notePath = commentFilePath(a.id, insA.id, randomUUID(), 'a-mock.txt');
  storedPaths.push(notePath);
  const upNote = await upload(a, notePath, 'A’s comment file');
  check('A can upload a file into A’s own comments folder', upNote.status === 200, `HTTP ${upNote.status} ${JSON.stringify(upNote.json)}`);
  const noteFile = await attachFile(a.store, fileStore(a), { taskId: insA.id, path: notePath, name: 'a-mock.txt', contentType: 'text/plain', sizeBytes: 17, commentId: noteA.id }, TOOL, commentStore(a));
  check('A can attach it to A’s own comment through core', noteFile.commentId === noteA.id && noteFile.ownerId === a.id, JSON.stringify(noteFile));

  const noteRowB = await call(`/rest/v1/task_files?id=eq.${noteFile.id}&select=name`, { token: b.token });
  check('B cannot see A’s comment file row', noteRowB.status === 200 && noteRowB.json.length === 0, `sees ${JSON.stringify(noteRowB.json)}`);
  const noteReadB = await call(`/storage/v1/object/authenticated/${BUCKET}/${notePath}`, { token: b.token });
  check('B cannot read A’s stored comment file', noteReadB.status >= 400, `HTTP ${noteReadB.status}`);
  const noteSignB = await call(`/storage/v1/object/sign/${BUCKET}/${notePath}`, { method: 'POST', token: b.token, body: { expiresIn: 60 } });
  check('B cannot get a link to A’s stored comment file', noteSignB.status >= 400, `HTTP ${noteSignB.status} ${JSON.stringify(noteSignB.json)}`);
  const noteReadA = await call(`/storage/v1/object/authenticated/${BUCKET}/${notePath}`, { token: a.token });
  check('A can read A’s own comment file', noteReadA.status === 200, `HTTP ${noteReadA.status}`);

  const onNoteB = await call('/rest/v1/task_files', { method: 'POST', token: b.token, body: { task_id: insA.id, comment_id: noteA.id, path: commentFilePath(b.id, insA.id, randomUUID(), 'b.txt'), name: 'b.txt', size_bytes: 1 } });
  check('B cannot attach a file to A’s comment', onNoteB.status >= 400, `HTTP ${onNoteB.status} ${onNoteB.json?.message ?? ''}`);
  const viaTaskB = await call('/rest/v1/task_files', { method: 'POST', token: b.token, body: { task_id: taskB, comment_id: noteA.id, path: commentFilePath(b.id, taskB, randomUUID(), 'b.txt'), name: 'b.txt', size_bytes: 1 } });
  check('B cannot hang a file on A’s comment from B’s own task', viaTaskB.status >= 400, `HTTP ${viaTaskB.status} ${viaTaskB.json?.message ?? ''}`);
  const strayA = await call('/rest/v1/task_files', { method: 'POST', token: a.token, body: { task_id: insA.id, comment_id: noteA.id, path: filePath(a.id, insA.id, randomUUID(), 'x.txt'), name: 'x.txt', size_bytes: 1 } });
  check('a comment file outside the comments folder is refused, even from its owner', strayA.status >= 400, `HTTP ${strayA.status} ${strayA.json?.message ?? ''}`);

  const noteDelRowB = await call(`/rest/v1/task_files?id=eq.${noteFile.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('B cannot delete A’s comment file row', noteDelRowB.status === 200 && noteDelRowB.json.length === 0, `HTTP ${noteDelRowB.status} ${JSON.stringify(noteDelRowB.json)}`);
  const noteDelObjB = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: b.token, body: { prefixes: [notePath] } });
  check('B cannot delete A’s stored comment file', Array.isArray(noteDelObjB.json) && noteDelObjB.json.length === 0, `HTTP ${noteDelObjB.status} ${JSON.stringify(noteDelObjB.json)}`);
  let refusedNote = '';
  try { await removeFile(fileStore(b), noteFile.id, TOOL); } catch (err) { refusedNote = err.message; }
  check('B cannot remove A’s comment file through core either', /No file .* you may remove/.test(refusedNote), refusedNote || 'the remove went through');
  refusedNote = '';
  try { await removeCommentWithFiles(commentStore(b), fileStore(b), noteA.id, TOOL); } catch (err) { refusedNote = err.message; }
  check('B cannot remove A’s comment and its files through core either', /No comment .* you may remove/.test(refusedNote), refusedNote || 'the remove went through');

  await removeCommentWithFiles(commentStore(a), fileStore(a), noteA.id, TOOL);
  const noteFolder = await admin(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', body: { prefix: `${a.id}/${insA.id}/comments/` } });
  const noteLeft = Array.isArray(noteFolder.json) ? noteFolder.json.map((o) => o.name) : noteFolder.json;
  const noteRows = await admin(`/rest/v1/task_files?comment_id=eq.${noteA.id}&select=id`);
  const noteGone = await admin(`/rest/v1/task_comments?id=eq.${noteA.id}&select=id`);
  check('A can remove A’s comment through core: its stored files and rows go with it', Array.isArray(noteLeft) && noteLeft.length === 0 && noteRows.json?.length === 0 && noteGone.json?.length === 0,
    `left in the folder ${JSON.stringify(noteLeft)}, rows ${JSON.stringify(noteRows.json)}, comment ${JSON.stringify(noteGone.json)}`);

  const doomedA = await createTask(a.store, { title: 'A’s task with a discussed file' }, TOOL);
  const doomedNote = await addComment(a.store, commentStore(a), doomedA.id, 'with a picture', TOOL);
  const doomedPath = commentFilePath(a.id, doomedA.id, randomUUID(), 'pic.txt');
  storedPaths.push(doomedPath);
  await upload(a, doomedPath, 'goes with the task');
  await attachFile(a.store, fileStore(a), { taskId: doomedA.id, path: doomedPath, name: 'pic.txt', sizeBytes: 18, commentId: doomedNote.id }, TOOL, commentStore(a));
  await deleteTaskWithFiles(a.store, fileStore(a), doomedA.id, TOOL);
  const doomedFolder = await admin(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', body: { prefix: `${a.id}/${doomedA.id}/comments/` } });
  const doomedLeft = Array.isArray(doomedFolder.json) ? doomedFolder.json.map((o) => o.name) : doomedFolder.json;
  check('deleting a task deletes its comments’ stored files', Array.isArray(doomedLeft) && doomedLeft.length === 0, `left in the folder ${JSON.stringify(doomedLeft)}`);

  // evolution_entries and the evolution bucket: every member reads the
  // Evolution screenshots and their rows; only the script, with the service
  // key, writes them.
  const evoRow = { commit_sha: evoSha, merged_at: new Date().toISOString(), title: 'check_tasks_rls test entry', page: '/', screenshot_path: evoPath, capture_state: 'captured' };
  const evoPut = await fetch(`${URL_}/storage/v1/object/${EVO_BUCKET}/${evoPath}`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'image/png' }, body: TINY_PNG });
  const evoIns = await admin('/rest/v1/evolution_entries', { method: 'POST', prefer: 'return=representation', body: evoRow });
  check('the script (service key) can store a screenshot and its row', evoPut.status < 300 && evoIns.status < 300, `storage HTTP ${evoPut.status}, row HTTP ${evoIns.status} ${JSON.stringify(evoIns.json)}`);
  const evoRead = await call(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}&select=title`, { token: b.token });
  check('a member can read the Evolution rows', evoRead.status === 200 && evoRead.json?.length === 1, `HTTP ${evoRead.status} ${JSON.stringify(evoRead.json)}`);
  const evoAnon = await call(`/rest/v1/evolution_entries?select=commit_sha`);
  check('a signed-out visitor sees no Evolution rows', evoAnon.status >= 400 || (Array.isArray(evoAnon.json) && evoAnon.json.length === 0), `HTTP ${evoAnon.status}`);
  const evoForge = await call('/rest/v1/evolution_entries', { method: 'POST', token: a.token, body: { ...evoRow, commit_sha: randomBytes(20).toString('hex') } });
  const evoEdit = await call(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { title: 'changed' } });
  const evoWipe = await call(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('a member cannot add, change or delete an Evolution row', evoForge.status >= 400 && (evoEdit.status >= 400 || evoEdit.json?.length === 0) && (evoWipe.status >= 400 || evoWipe.json?.length === 0),
    `add HTTP ${evoForge.status}, change HTTP ${evoEdit.status} ${JSON.stringify(evoEdit.json)}, delete HTTP ${evoWipe.status} ${JSON.stringify(evoWipe.json)}`);
  const evoObj = await call(`/storage/v1/object/authenticated/${EVO_BUCKET}/${evoPath}`, { token: b.token });
  check('a member can read a stored screenshot', evoObj.status === 200, `HTTP ${evoObj.status}`);
  const evoPublic = await call(`/storage/v1/object/public/${EVO_BUCKET}/${evoPath}`);
  const evoAnonObj = await call(`/storage/v1/object/authenticated/${EVO_BUCKET}/${evoPath}`);
  check('the evolution bucket is private: a signed-out request for a screenshot is refused', evoPublic.status >= 400 && evoAnonObj.status >= 400, `public HTTP ${evoPublic.status}, signed-out HTTP ${evoAnonObj.status}`);
  const evoSign = await call(`/storage/v1/object/upload/sign/${EVO_BUCKET}/${a.id}-forged.png`, { method: 'POST', token: a.token, body: {} });
  const evoUp = await fetch(`${URL_}/storage/v1/object/${EVO_BUCKET}/${a.id}-forged.png`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${a.token}`, 'Content-Type': 'image/png' }, body: TINY_PNG });
  const evoDel = await call(`/storage/v1/object/${EVO_BUCKET}`, { method: 'DELETE', token: a.token, body: { prefixes: [evoPath] } });
  const evoStill = await admin(`/storage/v1/object/list/${EVO_BUCKET}`, { method: 'POST', body: { prefix: '', search: evoPath } });
  check('a member cannot upload or delete a screenshot', evoSign.status >= 400 && evoUp.status >= 400 && Array.isArray(evoStill.json) && evoStill.json.some((o) => o.name === evoPath),
    `sign HTTP ${evoSign.status}, upload HTTP ${evoUp.status}, delete HTTP ${evoDel.status}, still stored ${JSON.stringify(evoStill.json?.map?.((o) => o.name))}`);

  // The game layer: every change above was scored by the database, each
  // member sees only their own engagements, and nobody can write the ledger.
  const parent = await createTask(a.store, { title: 'A’s plan' }, TOOL);
  await createTask(a.store, { title: 'A’s step', parentTaskId: parent.id }, TOOL);
  const onParent = await addComment(a.store, commentStore(a), parent.id, 'goes with the task', TOOL);
  await deleteTask(a.store, parent.id, 'rls-check-deleter');
  const cascaded = await admin(`/rest/v1/task_comments?id=eq.${onParent.id}&select=id`);
  check('deleting a task deletes its comments', Array.isArray(cascaded.json) && cascaded.json.length === 0, JSON.stringify(cascaded.json));

  const ledgerA = await call('/rest/v1/engagements?select=member_id,kind,points,tool,task_id&order=created_at', { token: a.token });
  const kindsA = Array.isArray(ledgerA.json) ? ledgerA.json.map((e) => e.kind) : ledgerA.json;
  console.log(`\nA's engagements, oldest first: ${JSON.stringify(kindsA)}`);
  const expected = [
    'made_task', 'changed_task', 'finished_task', 'switched_agents', 'changed_profile', 'attached_file', 'removed_file',
    'attached_file', 'removed_file', 'made_task', 'attached_file', 'deleted_task',
    'made_task', 'made_task', 'deleted_task',
  ];
  check('every change A made was recorded and scored, once each, in order', JSON.stringify(kindsA) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}`);
  check('every one of A’s engagements is credited to A and names its tool', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.member_id === a.id && e.tool),
    JSON.stringify(ledgerA.json));
  check('finishing a task is worth 5 and the rest 1, from the rules', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.points === (e.kind === 'finished_task' ? 5 : 1)),
    JSON.stringify(ledgerA.json?.map?.((e) => [e.kind, e.points])));
  const deleted = Array.isArray(ledgerA.json) ? ledgerA.json.findLast((e) => e.kind === 'deleted_task') : null;
  check('a delete names the tool that deleted, and its task', deleted?.tool === 'rls-check-deleter' && deleted?.task_id === parent.id, JSON.stringify(deleted));

  const totalA = await call(`/rest/v1/engagement_totals?member_id=eq.${a.id}&select=points`, { token: a.token });
  check('A’s points total adds up A’s engagements', totalA.json?.[0]?.points === 19, `total ${JSON.stringify(totalA.json)}`);

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
  check('a member can read the scoring rules, every kind among them, profiles and voting too', rulesA.status === 200 && ruleKinds.length === ENGAGEMENT_KINDS.length && ENGAGEMENT_KINDS.every((k) => ruleKinds.includes(k)), `HTTP ${rulesA.status} ${JSON.stringify(rulesA.json)}`);
  const anonEng = await call('/rest/v1/engagements?select=kind');
  const anonRules = await call('/rest/v1/game_scoring_rules?select=kind');
  check('a signed-out visitor sees no engagements and no rules', [anonEng, anonRules].every((r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0)), `HTTP ${anonEng.status} / ${anonRules.status}`);

  // Game management (20261031140000_game_scoring_admin.sql): only a role with
  // game.edit (admin; A is one, B a viewer) changes a rule or adds an action,
  // only through update_scoring_rule / add_scoring_rule; a change counts from
  // the next engagement; what was earned keeps its points. Whatever this
  // changes is put back below, so the rules end as they started.
  const ruleRow = async (kind) => (await admin(`/rest/v1/game_scoring_rules?kind=eq.${kind}&select=kind,name,description,criteria,points,position,tool,changed_by`)).json?.[0];
  const original = await ruleRow('made_task');
  const addedName = `RLS check ${[...randomBytes(6)].map((n) => String.fromCharCode(97 + (n % 26))).join('')}`;
  const addedKind = addedName.toLowerCase().replace(/[^a-z]+/g, '_');
  try {
    const rpcBody = (extra = {}) => ({ rule_kind: 'made_task', new_name: original.name, new_description: original.description, new_criteria: original.criteria, new_points: 1000, tool: TOOL, ...extra });
    const addBody = { new_kind: addedKind, new_name: addedName, new_description: '', new_criteria: '', new_points: 2, tool: TOOL };
    const byB = await call('/rest/v1/rpc/update_scoring_rule', { method: 'POST', token: b.token, body: rpcBody() });
    const addByB = await call('/rest/v1/rpc/add_scoring_rule', { method: 'POST', token: b.token, body: addBody });
    const byAnon = await call('/rest/v1/rpc/update_scoring_rule', { method: 'POST', body: rpcBody() });
    check('a non-admin cannot change a scoring rule or add an action through the database', byB.status >= 400 && addByB.status >= 400 && byAnon.status >= 400,
      `HTTP ${byB.status} ${byB.json?.message ?? ''} / ${addByB.status} / signed out ${byAnon.status}`);
    const bumpRuleB = await call('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { points: 1000 } });
    const forgeRule = await call('/rest/v1/game_scoring_rules', { method: 'POST', token: a.token, body: { kind: 'forged_rule', name: 'Forged', points: 1000 } });
    const wipeRule = await call('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'DELETE', token: a.token, prefer: 'return=representation' });
    check('not even an admin writes or deletes a rule directly through the API', [bumpRuleB, wipeRule].every((r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0)) && forgeRule.status >= 400,
      `PATCH ${bumpRuleB.status} / POST ${forgeRule.status} / DELETE ${wipeRule.status}`);
    const negative = await call('/rest/v1/rpc/update_scoring_rule', { method: 'POST', token: a.token, body: rpcBody({ new_points: -1 }) });
    const noPoints = await call('/rest/v1/rpc/update_scoring_rule', { method: 'POST', token: a.token, body: rpcBody({ new_points: null }) });
    const noToolRule = await call('/rest/v1/rpc/update_scoring_rule', { method: 'POST', token: a.token, body: rpcBody({ tool: ' ' }) });
    check('negative or missing points, and no tool, are refused even for an admin', [negative, noPoints, noToolRule].every((r) => r.status >= 400), `HTTP ${negative.status} / ${noPoints.status} / ${noToolRule.status}`);
    check('and nothing refused was saved', (await ruleRow('made_task'))?.points === original.points, JSON.stringify(await ruleRow('made_task')));

    let refusedRule = '';
    try {
      await changeScoringRule(scoringStore(b), { role: 'viewer' }, { ...original, points: 1000 }, TOOL);
    } catch (err) {
      refusedRule = err.message;
    }
    check('a non-admin cannot change a rule through core either', /Only an admin/.test(refusedRule), refusedRule || 'the change went through');

    const madeBefore = (await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_task&select=points`, { token: a.token })).json ?? [];
    const changed = await changeScoringRule(scoringStore(a), { role: 'admin' }, { ...original, points: original.points + 2 }, TOOL);
    const stored = await ruleRow('made_task');
    check('an admin changes a rule through core, and the database records who and with which tool',
      changed.after.points === original.points + 2 && stored?.points === original.points + 2 && stored?.tool === TOOL && stored?.changed_by === a.id, JSON.stringify(stored));
    await createTask(a.store, { title: 'Worth more now' }, TOOL);
    const madeAfter = (await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_task&select=points&order=created_at`, { token: a.token })).json ?? [];
    check('the next engagement earns the new value; earlier ones keep theirs',
      madeAfter.length === madeBefore.length + 1 && madeAfter.at(-1)?.points === original.points + 2 && madeAfter.slice(0, -1).every((e) => e.points === original.points),
      JSON.stringify(madeAfter));

    const added = await addScoringRule(scoringStore(a), { role: 'admin' }, { name: addedName, points: 2 }, TOOL);
    const listed = (await call('/rest/v1/game_scoring_rules?select=kind,position&order=position', { token: b.token })).json ?? [];
    check('an admin adds a new action through core; every member sees it, last in the list',
      added.kind === addedKind && listed.at(-1)?.kind === addedKind && listed.at(-1)?.position === listed.length, JSON.stringify(listed.slice(-2)));
    const again = await call('/rest/v1/rpc/add_scoring_rule', { method: 'POST', token: a.token, body: addBody });
    const badKind = await call('/rest/v1/rpc/add_scoring_rule', { method: 'POST', token: a.token, body: { ...addBody, new_kind: 'Bad-Kind1' } });
    check('the same action cannot be added twice, and a kind must be a to z and _', again.status >= 400 && badKind.status >= 400, `HTTP ${again.status} / ${badKind.status}`);
    const earned = (await call(`/rest/v1/engagements?kind=eq.${addedKind}&select=id`, { token: a.token })).json ?? [];
    check('a new action earns nothing until it is wired in', Array.isArray(earned) && earned.length === 0, JSON.stringify(earned));
  } finally {
    const { kind, position, tool, changed_by, ...wording } = original ?? {};
    const restored = await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', body: { ...wording, tool, changed_by } });
    const removed = await admin(`/rest/v1/game_scoring_rules?kind=eq.${addedKind}`, { method: 'DELETE' });
    if (restored.status >= 300 || removed.status >= 300) {
      failures += 1;
      console.error(`could not put the scoring rules back (HTTP ${restored.status} / ${removed.status}) — set made_task to ${original?.points} and delete ${addedKind} by hand`);
    }
  }

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

  // A vote is the voter's engagement: the owner earns nothing for it, a task
  // deleted with votes on it scores no votes, and a voter's account can be
  // deleted (its vote leaves the average).
  const countOf = async (member, filter = '') => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}${filter}&select=kind`)).json?.length;
  const bBefore = await countOf(b);
  await castVote(voteStore(a), taskB, { points: 2, priority: 'low' }, TOOL);
  await castVote(voteStore(a), taskB, { points: 2, priority: 'low' }, TOOL);
  await castVote(voteStore(a), taskB, { points: 8, priority: 'high' }, TOOL);
  const bAfter = await countOf(b);
  check('the owner earns nothing when another member votes on their task', bBefore === bAfter, `B had ${bBefore} engagements, then ${bAfter}`);

  const doomed = await createTask(b.store, { title: 'B’s task to delete', points: 1 }, TOOL);
  await castVote(voteStore(a), doomed.id, { points: 3 }, TOOL);
  await castVote(voteStore(b), doomed.id, { priority: 'high' }, TOOL);
  const votesBefore = [await countOf(a, '&kind=eq.voted_on_task'), await countOf(b, '&kind=eq.voted_on_task')];
  await deleteTask(b.store, doomed.id, TOOL);
  const votesAfter = [await countOf(a, '&kind=eq.voted_on_task'), await countOf(b, '&kind=eq.voted_on_task')];
  check('deleting a task with votes on it scores no votes', JSON.stringify(votesBefore) === JSON.stringify(votesAfter), `before ${JSON.stringify(votesBefore)}, after ${JSON.stringify(votesAfter)}`);

  const c = await makeUser('c');
  await castVote(voteStore(c), taskB, { points: 2, priority: 'low' }, TOOL);
  shown = await taskOf(taskB);
  const withC = shown;
  const bBeforeC = await countOf(b);
  const goneC = await admin(`/auth/v1/admin/users/${c.id}`, { method: 'DELETE' });
  if (goneC.status < 300) users.splice(users.indexOf(c.id), 1);
  shown = await taskOf(taskB);
  check('a member who has voted can have their account deleted', goneC.status < 300, `HTTP ${goneC.status} ${JSON.stringify(goneC.json)}`);
  check('their vote leaves the average with them', withC?.points === 5 && withC?.priority === 'normal' && shown?.points === 8 && shown?.priority === 'high', `with C ${JSON.stringify(withC)}, after ${JSON.stringify(shown)}`);
  check('and the owner earns nothing for it', bBeforeC === await countOf(b), `B had ${bBeforeC} engagements`);
} catch (err) {
  failures += 1;
  console.error(`check_tasks_rls broke: ${err.message}`);
} finally {
  const evoGone = await admin(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}`, { method: 'DELETE' });
  const evoObjGone = await admin(`/storage/v1/object/${EVO_BUCKET}`, { method: 'DELETE', body: { prefixes: [evoPath, `${users[0]}-forged.png`] } });
  if (evoGone.status >= 300 || evoObjGone.status >= 300) {
    failures += 1;
    console.error(`could not delete the test Evolution entry ${evoSha}: row HTTP ${evoGone.status}, picture HTTP ${evoObjGone.status} — delete it by hand in the Supabase dashboard`);
  }
  // Deleting a user does not delete a team they made, so clear the test teams.
  if (teamIds.length) {
    const cleared = await admin(`/rest/v1/teams?id=in.(${teamIds.join(',')})`, { method: 'DELETE' });
    if (cleared.status >= 300) {
      failures += 1;
      console.error(`could not delete the test teams ${teamIds.join(', ')}: HTTP ${cleared.status} — delete them by hand in the Supabase dashboard`);
    }
  }
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
