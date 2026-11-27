#!/usr/bin/env node
/**
 * Prove, through the real Supabase API, that every member can read every
 * task and attached file, that a role's task permissions decide who adds,
 * changes and deletes tasks (a reviewer or viewer adds none, a contributor
 * changes and deletes only their own, an editor or admin anyone's) and only a
 * task's owner changes its points (row-level security on `public.tasks`),
 * that a member cannot change another member's settings, profile
 * (`public.member_profiles`), or attached files (`public.task_files` and the
 * private `task-files` bucket); that a member cannot see or change another
 * member's Discussion comments (`public.task_comments`) or the files attached
 * to them; that members vote on
 * any task, only ever through their own vote, and the average becomes the
 * task's points and priority (`public.task_votes`); that every member reads
 * the roles and permissions lists but nobody writes them, a member reads only
 * their own role row, every member lists the members, and only an admin
 * changes a role
 * (`public.member_roles`); that every member, a viewer too, sends a message
 * only through send_message, only its sender and recipient read it, and no
 * member's session is ever handed an email address (`public.messages`,
 * `message_recipient_email`); that a member stars and trashes only messages
 * they sent or received, only through set_message_mark, and reads only their
 * own marks (`public.message_marks`); that any two members chat only through
 * start_chat and send_chat_message, and a member reads a chat, its members
 * and its messages only when they are in it (`public.chats`,
 * `public.chat_members`, `public.chat_messages`), and only they mark a chat
 * read for themselves, which clears its unread count for them alone
 * (`mark_chat_read`, `my_chat_unread`); that every member reads the teams and their
 * members (each shown only as their profile allows) but only an admin or an
 * editor changes them (`public.teams`, `public.team_members`); that every
 * member sees the teams' meetings and who is invited, but only a member of a
 * meeting's team plans, changes or deletes it and invites anyone
 * (`public.meetings`, `public.meeting_invites`); that a task
 * added by anyone but an admin is Proposed, stays so, never goes to AI agents,
 * and only an admin approves it (`approve_task`); and that the game layer
 * scores every change while letting each member read only their own
 * engagements and nobody write them (`public.engagements`); that only an
 * admin changes a scoring rule or adds an action, through the database's own
 * functions, with the change counting from the next engagement
 * (`public.game_scoring_rules`); and that every member reads the Evolution
 * rows and screenshots but only the service key writes them
 * (`public.evolution_entries` and the private `evolution` bucket); and that
 * every member reads the words in Home's boxes but only an admin changes
 * them (`public.home_boxes`), which are put back as they were afterwards;
 * that every member reads the token sizes but only a role with Manage game
 * scoring adds, changes or removes one (`public.token_sizes`), also put back
 * afterwards; that every member reads every proposal but adds, changes and deletes
 * only their own (`public.proposals`); and that every member reads the AI's
 * task rating passes, only the service key saves one, whole, through
 * `record_ai_task_rating`, nobody changes or deletes one, and the save refuses
 * a pass off the scale or without its reasons (`public.ai_task_ratings`,
 * `public.ai_task_model_ratings`); and that every member reads and adds Forum
 * topics and tags, and only a topic's adder or an admin changes or deletes
 * a topic, with its slug, details and parent kept well formed and free of
 * loops (`public.forum_topics`); and the same for a tag, whose related tags
 * are two-way, never itself, changed only by whoever may change one of the
 * two tags and gone when either tag is (`public.forum_tags`,
 * `public.forum_tag_relations`); and that only a role with Manage website adds
 * a page of the website, as an empty draft only it sees, a published page is
 * seen by anyone, and only such a role renames, readdresses, publishes or
 * deletes one, or saves its sections (at most 50, at most 200000 bytes),
 * with the change time stamped (`public.site_pages`); and that only such a
 * role saves a section reused on many pages or changes its content, which
 * anyone else reads only when a published page follows it
 * (`public.site_sections`).
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
import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_FALLBACK_TOOL, newAccountData } from '../core/accounts.ts';
import { setAgentsOn } from '../core/agents.ts';
import { addComment, editComment, removeComment } from '../core/comments.ts';
import { ENGAGEMENT_KINDS, RESCORE_TOOL, addScoringRule, castScoringRuleVote, summarizeScoringRuleVotes, applyGranularPoints, applyRescore, makeScoringFinal, previewRescore, changeFactorReasons, changeScoringFactors, changeScoringRule, recalculateGranularPoints } from '../core/game.ts';
import { saveHomeBox } from '../core/homeBoxes.ts';
import { addTokenSize, changeTokenSize, removeTokenSize } from '../core/tokens.ts';
import { createProposal, deleteProposal, updateProposal } from '../core/proposals.ts';
import { memberPermissions, setMemberRole } from '../core/members.ts';
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, updateTeam } from '../core/teams.ts';
import { createMeeting, deleteMeeting, setMeetingInvites, updateMeeting } from '../core/meetings.ts';
import { loadProfile, saveProfile } from '../core/profiles.ts';
import { attachFile, commentFilePath, deleteTaskWithFiles, filePath, removeCommentWithFiles, removeFile } from '../core/files.ts';
import { approveTask, createTask, deleteTask, updateTask } from '../core/tasks.ts';
import { setPoints } from '../core/points.ts';
import { castVote } from '../core/votes.ts';
import { restTaskStore, TOOL_HEADER } from './lib/restTaskStore.mjs';
import { isLocalUrl } from './lib/migrations.mjs';

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
/** A test member; `data` is the user metadata the account is made with, as register sends it. */
async function makeUser(tag, data) {
  const email = `rls-check-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const made = await admin('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: data } });
  if (made.status >= 300) throw new Error(`could not create test user ${tag}: HTTP ${made.status} ${JSON.stringify(made.json)}`);
  users.push(made.json.id);
  const signin = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (signin.status >= 300) throw new Error(`could not sign in test user ${tag}: HTTP ${signin.status} ${JSON.stringify(signin.json)}`);
  const token = signin.json.access_token;
  return { tag, id: made.json.id, email, token, store: restTaskStore({ url: URL_, apiKey: ANON, token, ownerId: made.json.id }) };
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
  const withFactors = (row) => row && typeof row === 'object'
    ? {
      ...row,
      factors: row.effort == null ? null : { effort: row.effort, value: row.value, rarity: row.rarity, farmRisk: row.farm_risk },
      reasons: { effort: row.effort_reason ?? null, value: row.value_reason ?? null, rarity: row.rarity_reason ?? null, farmRisk: row.farm_risk_reason ?? null },
    }
    : row;
  return {
    async rules() {
      return ((await call('/rest/v1/game_scoring_rules?select=*&order=position', { token: member.token })).json ?? []).map(withFactors);
    },
    update: async (kind, fields, tool) => withFactors(await save('update_scoring_rule', 'rule_kind', kind, fields, tool)),
    add: async (kind, fields, tool) => withFactors(await save('add_scoring_rule', 'new_kind', kind, fields, tool)),
    async setFactors(kind, factors, tool) {
      const got = await call('/rest/v1/rpc/set_scoring_factors', {
        method: 'POST', token: member.token,
        body: { rule_kind: kind, new_effort: factors?.effort ?? null, new_value: factors?.value ?? null, new_rarity: factors?.rarity ?? null, new_farm_risk: factors?.farmRisk ?? null, tool },
      });
      if (got.status >= 300) throw new Error(`set_scoring_factors failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return withFactors(got.json);
    },
    async setReasons(kind, reasons, tool) {
      const got = await call('/rest/v1/rpc/set_scoring_factor_reasons', {
        method: 'POST', token: member.token,
        body: { rule_kind: kind, new_effort_reason: reasons.effort, new_value_reason: reasons.value, new_rarity_reason: reasons.rarity, new_farm_risk_reason: reasons.farmRisk, tool },
      });
      if (got.status >= 300) throw new Error(`set_scoring_factor_reasons failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return withFactors(got.json);
    },
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

/** The tasks a member may comment on, for core's addComment: every task they can read, not only their own. */
function readableTasks(member) {
  return restTaskStore({ url: URL_, apiKey: ANON, token: member.token });
}

/**
 * Listen live to one task's comments through Supabase Realtime, the way the
 * browser does: as the member whose token it is, or as a signed-out visitor
 * (`token` null). Resolves once the connection has said yes or no.
 */
async function listenToComments(token, taskId) {
  // The client asks this for the member's token on connect and every
  // heartbeat (a token set by hand would be overridden); the browser's comes
  // from the session cookie the same way. No token: the public key, as a
  // signed-out visitor.
  const client = token
    ? createClient(URL_, ANON, { accessToken: async () => token })
    : createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  // Fetch the token before joining, or the join goes out as a signed-out
  // visitor (app/lib/realtimeClient.ts waits the same way).
  await client.realtime.setAuth();
  const events = [];
  const channel = client.channel(`rls-check:${randomUUID()}`);
  // The same two listens as app/lib/realtimeClient.ts: everything about this task, and every delete.
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` }, (e) => events.push(e));
  channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_comments' }, (e) => events.push(e));
  // Listening only once Realtime's "system" message says the database side
  // is ready: "SUBSCRIBED" alone comes a moment earlier, and a change made in
  // between is never sent.
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NO ANSWER IN 15 SECONDS'), 15_000);
    const done = (s) => { clearTimeout(timer); resolve(s); };
    channel.on('system', {}, (m) => { if (m.extension === 'postgres_changes') done(m.status === 'ok' ? 'LISTENING' : `REFUSED: ${m.message}`); });
    channel.subscribe((s) => { if (s !== 'SUBSCRIBED' && s !== 'CLOSED') done(s); });
  });
  return {
    status,
    events,
    /** The events that match, once at least one has arrived or 10 seconds have passed. */
    async waitFor(match) {
      for (let waited = 0; waited < 10_000 && !events.some(match); waited += 200) await new Promise((r) => setTimeout(r, 200));
      return events.filter(match);
    },
    async stop() {
      await client.removeChannel(channel);
      client.realtime.disconnect();
    },
  };
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
    async remove(id, tool) {
      const got = await call(`/rest/v1/task_comments?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool });
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

/** A HomeBoxStore (core/homeBoxes.ts) over REST, acting as one member. */
/** A TokenStore (core/tokens.ts) over REST, acting as one member. */
function tokenStore(member) {
  const fromRow = (r) => r && { id: r.id, name: r.name, diameter: r.diameter, color: r.color, minPoints: r.min_points, tool: r.tool, updatedAt: r.updated_at };
  const toRow = (f, tool) => ({ name: f.name, diameter: f.diameter, color: f.color, min_points: f.minPoints, tool });
  const write = async (path, method, body, tool) => {
    const got = await call(path, { method, token: member.token, prefer: 'return=representation', body, tool });
    if (got.status >= 300) throw new Error(`token_sizes ${method} failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    return got.json ?? [];
  };
  return {
    async list() {
      return ((await call('/rest/v1/token_sizes?select=*&order=min_points', { token: member.token })).json ?? []).map(fromRow);
    },
    async add(fields, tool) { return fromRow((await write('/rest/v1/token_sizes', 'POST', toRow(fields, tool)))[0]) ?? null; },
    async change(id, fields, tool) { return fromRow((await write(`/rest/v1/token_sizes?id=eq.${id}`, 'PATCH', toRow(fields, tool)))[0]) ?? null; },
    async remove(id, tool) { return (await write(`/rest/v1/token_sizes?id=eq.${id}`, 'DELETE', undefined, tool)).length > 0; },
  };
}

function homeBoxStore(member) {
  const fromRow = (r) => r && { box: r.box, body: r.body, tool: r.tool, updatedAt: r.updated_at, updatedBy: r.updated_by };
  return {
    async list() {
      return ((await call('/rest/v1/home_boxes?select=*', { token: member.token })).json ?? []).map(fromRow);
    },
    async save(box, body, tool) {
      const got = await call('/rest/v1/home_boxes?on_conflict=box', {
        method: 'POST', token: member.token, prefer: 'resolution=merge-duplicates,return=representation', body: { box, body, tool },
      });
      if (got.status >= 300) throw new Error(`home_boxes save failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
      return fromRow(got.json?.[0]) ?? null;
    },
  };
}

/** A ProposalStore (core/proposals.ts) over REST, acting as one member. */
function proposalStore(member) {
  const COLUMNS = { title: 'title', notes: 'notes', status: 'status', parentProposalId: 'parent_proposal_id', points: 'points', position: 'position', priority: 'priority', tool: 'tool' };
  const toRow = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [COLUMNS[k], v]));
  const fromRow = (r) => r && {
    id: r.id, title: r.title, notes: r.notes, ownerId: r.owner_id, status: r.status, parentProposalId: r.parent_proposal_id,
    points: r.points, position: r.position, priority: r.priority, tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  const mine = (id) => `/rest/v1/proposals?id=eq.${id}&owner_id=eq.${member.id}`;
  const sure = (got, what) => {
    if (got.status >= 300) throw new Error(`proposals ${what} failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    return got.json ?? [];
  };
  return {
    async insert(row) {
      return fromRow(sure(await call('/rest/v1/proposals', { method: 'POST', token: member.token, prefer: 'return=representation', body: toRow(row) }), 'insert')[0]);
    },
    async get(id) {
      return fromRow(sure(await call(`${mine(id)}&select=*`, { token: member.token }), 'read')[0]) ?? null;
    },
    async update(id, changes) {
      return fromRow(sure(await call(mine(id), { method: 'PATCH', token: member.token, prefer: 'return=representation', body: toRow(changes) }), 'update')[0]) ?? null;
    },
    async remove(id, tool) {
      return sure(await call(mine(id), { method: 'DELETE', token: member.token, prefer: 'return=representation', tool }), 'delete').length > 0;
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
    async remove(id, tool) {
      return rows(await call(`/rest/v1/teams?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool }), 'teams delete').length > 0;
    },
    async hasMember(teamId, memberId) {
      return rows(await call(`/rest/v1/team_members?team_id=eq.${teamId}&member_id=eq.${memberId}&select=member_id`, { token: member.token }), 'team_members read').length > 0;
    },
    async addMember(teamId, memberId, tool) {
      return rows(await call('/rest/v1/team_members', { method: 'POST', token: member.token, prefer: 'return=representation', body: { team_id: teamId, member_id: memberId, tool } }), 'team_members insert').length > 0;
    },
    async removeMember(teamId, memberId, tool) {
      return rows(await call(`/rest/v1/team_members?team_id=eq.${teamId}&member_id=eq.${memberId}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool }), 'team_members delete').length > 0;
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
  const b = await makeUser('b', newAccountData(TOOL));
  console.log(`two test users made and signed in: A=${a.id}  B=${b.id}\n`);

  const joined = await admin(`/rest/v1/engagements?kind=eq.joined_wavecenter&member_id=in.(${a.id},${b.id})&select=member_id,points,tool,task_id`);
  const joinedBy = (m) => (joined.json ?? []).filter((e) => e.member_id === m.id);
  check('a new account scores 1 for joining, credited to the new member, naming the tool it was made with',
    joinedBy(a).length === 1 && joinedBy(b).length === 1 && joined.json.every((e) => e.points === 1 && e.task_id === null)
      && joinedBy(a)[0].tool === ACCOUNT_FALLBACK_TOOL && joinedBy(b)[0].tool === TOOL,
    JSON.stringify(joined.json));

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
  check('A still cannot put a sub-task under B’s task through core', /No task .* you may put this task under/.test(mayParent), mayParent || 'the sub-task was added');

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
  check('B cannot change A’s task through core either', /only your own tasks/.test(refused), refused || 'the change went through');

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
  const approvals = await admin(`/rest/v1/engagements?kind=eq.approved_a_proposed_task&task_id=in.(${insA.id},${skipped.id})&select=member_id,points,tool,task_id`);
  check('approving a proposed task scores 1 for the admin who approved it, once, naming the tool; the service key’s approval scores nobody',
    approvals.json?.length === 1 && approvals.json[0].member_id === a.id && approvals.json[0].points === 1 && approvals.json[0].tool === TOOL && approvals.json[0].task_id === skipped.id,
    JSON.stringify(approvals.json));
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
  await setMemberRole(roleStore(a), { actorId: a.id, memberId: b.id, role: 'viewer' }, TOOL);
  const roleScoreA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.changed_a_member_s_role&select=points,tool,task_id`);
  const roleScoreB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.changed_a_member_s_role&select=id`);
  check('changing a role scores 1 for the admin who changed it, never the member, naming the tool; saving the same role, or a service-key write, scores nothing',
    roleScoreA.json?.length === 1 && roleScoreA.json.every((e) => e.points === 1 && e.tool === TOOL && e.task_id === null) && roleScoreB.json?.length === 0,
    `A ${JSON.stringify(roleScoreA.json)}, B ${JSON.stringify(roleScoreB.json)}`);
  const allA = await call('/rest/v1/member_roles?select=member_id', { token: a.token });
  check('an admin reads every role row', allA.json?.some((r) => r.member_id === a.id) && allA.json?.some((r) => r.member_id === b.id), JSON.stringify(allA.json));
  const bumpB = await call(`/rest/v1/member_roles?member_id=eq.${b.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { role: 'admin' } });
  check('a member cannot change their own role row directly', bumpB.status >= 400 || (Array.isArray(bumpB.json) && bumpB.json.length === 0), `HTTP ${bumpB.status} ${JSON.stringify(bumpB.json)}`);
  const anonRoleRows = await call('/rest/v1/member_roles?select=member_id');
  const anonList = await call('/rest/v1/rpc/list_members', { method: 'POST', body: {} });
  check('a signed-out visitor sees no roles and cannot list members', (anonRoleRows.status >= 400 || anonRoleRows.json?.length === 0) && anonList.status >= 400, `rows HTTP ${anonRoleRows.status}, list HTTP ${anonList.status}`);
  const stillViewer = await admin(`/rest/v1/member_roles?member_id=eq.${b.id}&select=role`);
  check('B is still a viewer afterwards', stillViewer.json?.[0]?.role === 'viewer', JSON.stringify(stillViewer.json));

  // Messages: a role with Message members (every role since 2026-11-01)
  // saves one, only through send_message; the sender and the recipient read it and nobody
  // else; nobody writes the table directly; only the sender records the
  // email result, once.
  const sendRpc = (who, body) => call('/rest/v1/rpc/send_message', { method: 'POST', token: who.token, body });
  const viewerSends = await sendRpc(b, { recipient: a.id, subject: 'Hi', body: 'Hello', tool: TOOL });
  const viewerRow = Array.isArray(viewerSends.json) ? viewerSends.json[0] : null;
  check('a viewer sends a message too (every member may message)', viewerSends.status === 200 && !!viewerRow?.id, `HTTP ${viewerSends.status} ${viewerSends.json?.message ?? ''}`);
  check('a viewer is not handed the recipient’s email address', viewerSends.status === 200 && !JSON.stringify(viewerSends.json).includes('@') && !('recipient_email' in (viewerRow ?? {})), JSON.stringify(viewerSends.json)?.replace(/[^@\s"]+@/g, '…@'));
  const forgeMessage = await call('/rest/v1/messages', { method: 'POST', token: b.token, body: { sender_id: a.id, recipient_id: b.id, subject: 'Forged', body: 'x', tool: TOOL } });
  check('a member cannot write a message row directly', forgeMessage.status >= 400, `HTTP ${forgeMessage.status} ${forgeMessage.json?.message ?? ''}`);
  const emptySubject = await sendRpc(a, { recipient: b.id, subject: ' ', body: 'Hello', tool: TOOL });
  check('the database refuses a message with no subject', emptySubject.status >= 400, `HTTP ${emptySubject.status} ${emptySubject.json?.message ?? ''}`);
  // core's trim() strips tabs and line breaks too; the database must agree.
  const newlineSubject = await sendRpc(a, { recipient: b.id, subject: '\n\t', body: 'Hello', tool: TOOL });
  check('the database refuses a message whose subject is only a line break and a tab', newlineSubject.status >= 400, `HTTP ${newlineSubject.status} ${newlineSubject.json?.message ?? ''}`);
  const newlineBody = await sendRpc(a, { recipient: b.id, subject: 'Hi', body: '\r\n', tool: TOOL });
  check('the database refuses a message whose text is only line breaks', newlineBody.status >= 400, `HTTP ${newlineBody.status} ${newlineBody.json?.message ?? ''}`);
  const noToolMessage = await sendRpc(a, { recipient: b.id, subject: 'Hi', body: 'Hello', tool: ' ' });
  check('the database refuses a message with no tool name', noToolMessage.status >= 400, `HTTP ${noToolMessage.status} ${noToolMessage.json?.message ?? ''}`);
  const toB = await sendRpc(a, { recipient: b.id, subject: 'Hi B', body: 'Hello B', tool: TOOL });
  const toBRow = Array.isArray(toB.json) ? toB.json[0] : null;
  check('an admin sends a message and is not handed the address either', toB.status === 200 && !!toBRow?.id && !JSON.stringify(toB.json).includes('@'), `HTTP ${toB.status} ${JSON.stringify(toB.json)?.replace(/[^@\s"]+@/g, '…@')}`);
  // The address comes only from message_recipient_email, which only the
  // server's service key may call, and only for a pending message the named
  // sender sent.
  const lookup = (opts, message, sender) => call('/rest/v1/rpc/message_recipient_email', { method: 'POST', ...opts, body: { message, sender } });
  const lookupA = await lookup({ token: a.token }, toBRow?.id, a.id);
  const lookupB = await lookup({ token: b.token }, viewerRow?.id, b.id);
  const lookupAnon = await lookup({}, toBRow?.id, a.id);
  check('no member’s session, an admin’s or a viewer’s, and no signed-out visitor may look an address up', lookupA.status >= 400 && lookupB.status >= 400 && lookupAnon.status >= 400 && ![lookupA, lookupB, lookupAnon].some((r) => JSON.stringify(r.json ?? '').includes('@')), `admin HTTP ${lookupA.status}, viewer HTTP ${lookupB.status}, signed out HTTP ${lookupAnon.status}`);
  const serverLookup = await lookup({ key: SERVICE }, toBRow?.id, a.id);
  const wrongSender = await lookup({ key: SERVICE }, toBRow?.id, b.id);
  check('the server’s service key looks up the recipient’s address, only for the message’s own sender', serverLookup.status === 200 && serverLookup.json === b.email && wrongSender.status === 200 && wrongSender.json === null, `right sender HTTP ${serverLookup.status} ${serverLookup.json === b.email ? 'the address' : JSON.stringify(serverLookup.json)}, wrong sender ${JSON.stringify(wrongSender.json)?.replace(/[^@\s"]+@/g, '…@')}`);
  const toSelf = await sendRpc(a, { recipient: a.id, subject: 'Note to self', body: 'Private', tool: TOOL });
  const toSelfRow = Array.isArray(toSelf.json) ? toSelf.json[0] : null;
  const messagesB = await call('/rest/v1/messages?select=id,subject,sender_id,recipient_id,email_status', { token: b.token });
  const idsB = (messagesB.json ?? []).map((m) => m.id).sort();
  check('B reads the message sent to them and the one they sent, and not A’s note to self', idsB.length === 2 && JSON.stringify(idsB) === JSON.stringify([toBRow?.id, viewerRow?.id].sort()) && !idsB.includes(toSelfRow?.id) && messagesB.json.find((m) => m.id === toBRow?.id)?.email_status === 'pending', JSON.stringify(messagesB.json));
  const messagesA = await call('/rest/v1/messages?select=id', { token: a.token });
  check('A reads the messages they sent and the one B sent them', messagesA.json?.length === 3, JSON.stringify(messagesA.json));
  const anonMessages = await call('/rest/v1/messages?select=id');
  check('a signed-out visitor reads no messages', anonMessages.status >= 400 || anonMessages.json?.length === 0, `HTTP ${anonMessages.status}`);
  const editMessage = await call(`/rest/v1/messages?id=eq.${toBRow?.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { body: 'Changed' } });
  const wipeMessage = await call(`/rest/v1/messages?id=eq.${toBRow?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('nobody changes or deletes a message directly', (editMessage.status >= 400 || editMessage.json?.length === 0) && (wipeMessage.status >= 400 || wipeMessage.json?.length === 0), `edit HTTP ${editMessage.status}, delete HTTP ${wipeMessage.status}`);
  const recordRpc = (who, message, status) => call('/rest/v1/rpc/record_message_email', { method: 'POST', token: who.token, body: { message, status } });
  const bRecords = await recordRpc(b, toBRow?.id, 'sent');
  check('only the sender records how the email went', bRecords.status >= 400, `HTTP ${bRecords.status} ${bRecords.json?.message ?? ''}`);
  const aRecords = await recordRpc(a, toBRow?.id, 'sent');
  const aRecordsAgain = await recordRpc(a, toBRow?.id, 'failed');
  check('the sender records the email result once', aRecords.status === 200 && aRecords.json === 'sent' && aRecordsAgain.status >= 400, `first HTTP ${aRecords.status} ${JSON.stringify(aRecords.json)}, second HTTP ${aRecordsAgain.status}`);
  const afterSent = await lookup({ key: SERVICE }, toBRow?.id, a.id);
  check('once a message is emailed, its address is no longer looked up', afterSent.status === 200 && afterSent.json === null, `HTTP ${afterSent.status} ${JSON.stringify(afterSent.json)?.replace(/[^@\s"]+@/g, '…@')}`);
  check('a note to oneself is saved too', !!toSelfRow?.id, JSON.stringify(toSelf.json)?.replace(/[^@\s"]+@/g, '…@'));

  {
    // Star and Trash (20261122120000_message_marks.sql): each member's own
    // marks on a message they sent or received, changed only through
    // set_message_mark, read only by them; the message and the other member's
    // marks never change.
    const starRpc = (who, body) => call('/rest/v1/rpc/set_message_mark', { method: 'POST', token: who.token, body: { tool: TOOL, star: null, trash: null, ...body } });
    const starRow = (r) => (Array.isArray(r.json) ? r.json[0] : null);
    const bStars = await starRpc(b, { message: toBRow?.id, star: true });
    const bTrashes = await starRpc(b, { message: toBRow?.id, trash: true });
    check('the recipient stars a message and puts it in their trash; the star stays when trashed', bStars.status === 200 && starRow(bStars)?.starred === true && starRow(bStars)?.trashed_at === null
      && bTrashes.status === 200 && starRow(bTrashes)?.starred === true && typeof starRow(bTrashes)?.trashed_at === 'string',
      `star HTTP ${bStars.status} ${JSON.stringify(bStars.json)}, trash HTTP ${bTrashes.status} ${JSON.stringify(bTrashes.json)}`);
    const aStars = await starRpc(a, { message: toBRow?.id, star: true });
    const aSelf = await starRpc(a, { message: toSelfRow?.id, trash: true });
    check('the sender marks their own copy too, and a note to oneself', aStars.status === 200 && starRow(aStars)?.trashed_at === null && aSelf.status === 200 && typeof starRow(aSelf)?.trashed_at === 'string',
      `star HTTP ${aStars.status} ${JSON.stringify(aStars.json)}, note HTTP ${aSelf.status} ${JSON.stringify(aSelf.json)}`);
    const bOnSelf = await starRpc(b, { message: toSelfRow?.id, star: true });
    const noMessage = await starRpc(b, { message: randomUUID(), star: true });
    const anonMark = await call('/rest/v1/rpc/set_message_mark', { method: 'POST', body: { message: toBRow?.id, star: true, trash: null, tool: TOOL } });
    check('nobody marks a message they neither sent nor received, or one that does not exist, and a signed-out visitor marks nothing', bOnSelf.status >= 400 && noMessage.status >= 400 && anonMark.status >= 400,
      `B on A's note HTTP ${bOnSelf.status}, no message HTTP ${noMessage.status}, signed out HTTP ${anonMark.status}`);
    const emptyMark = await starRpc(b, { message: toBRow?.id });
    const noToolMark = await starRpc(b, { message: toBRow?.id, star: false, tool: ' ' });
    check('a mark with nothing to change or no tool name is refused', emptyMark.status >= 400 && noToolMark.status >= 400, `nothing HTTP ${emptyMark.status}, no tool HTTP ${noToolMark.status}`);
    const marksB = await call('/rest/v1/message_marks?select=message_id,member_id,starred,trashed_at,tool', { token: b.token });
    const marksA = await call('/rest/v1/message_marks?select=message_id,member_id,starred,trashed_at', { token: a.token });
    const anonMarks = await call('/rest/v1/message_marks?select=message_id');
    check('each member reads only their own marks: B sees one, trashed and starred, and A\'s are not among them; a signed-out visitor reads none',
      marksB.json?.length === 1 && marksB.json[0].member_id === b.id && marksB.json[0].starred === true && !!marksB.json[0].trashed_at && marksB.json[0].tool === TOOL
        && marksA.json?.length === 2 && marksA.json.every((m) => m.member_id === a.id)
        && marksA.json.find((m) => m.message_id === toBRow?.id)?.trashed_at === null
        && (anonMarks.status >= 400 || anonMarks.json?.length === 0),
      `B ${JSON.stringify(marksB.json)}, A ${JSON.stringify(marksA.json)}, signed out HTTP ${anonMarks.status}`);
    const forgeMark = await call('/rest/v1/message_marks', { method: 'POST', token: b.token, body: { message_id: toSelfRow?.id, member_id: a.id, starred: true, tool: TOOL } });
    const editMark = await call(`/rest/v1/message_marks?message_id=eq.${toBRow?.id}&member_id=eq.${a.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { starred: false } });
    const editOwnMark = await call(`/rest/v1/message_marks?message_id=eq.${toBRow?.id}&member_id=eq.${b.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { trashed_at: null } });
    const wipeMark = await call(`/rest/v1/message_marks?message_id=eq.${toBRow?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
    const aStill = await admin(`/rest/v1/message_marks?message_id=eq.${toBRow?.id}&member_id=eq.${a.id}&select=starred`);
    check('nobody writes, changes or deletes a mark directly, their own or another member\'s', forgeMark.status >= 400
      && [editMark, editOwnMark, wipeMark].every((r) => r.status >= 400 || r.json?.length === 0) && aStill.json?.[0]?.starred === true,
      `forge HTTP ${forgeMark.status}, edit other HTTP ${editMark.status}, edit own HTTP ${editOwnMark.status}, delete HTTP ${wipeMark.status}, A's star ${JSON.stringify(aStill.json)}`);
    const bRestores = await starRpc(b, { message: toBRow?.id, trash: false });
    const stillThere = await admin(`/rest/v1/messages?id=eq.${toBRow?.id}&select=subject,body`);
    check('restoring clears only the trash, and trashing never touched the message itself', bRestores.status === 200 && starRow(bRestores)?.trashed_at === null && starRow(bRestores)?.starred === true
      && stillThere.json?.[0]?.subject === 'Hi B' && stillThere.json?.[0]?.body === 'Hello B',
      `restore HTTP ${bRestores.status} ${JSON.stringify(bRestores.json)}, message ${JSON.stringify(stillThere.json)}`);
  }
  // Starring a message earns its point
  // (20261123200000_score_starred_a_message.sql, WC-196): a message that was
  // not starred becoming starred is scored once for the member whose mark it
  // is, naming the mark's tool; starring it again, taking the star off, the
  // trash, a refused mark and a service-key write score nothing; nobody can
  // write the engagement themselves. The block above left A and B one scored
  // star each (both on A's message to B).
  let starredPointsA = 0;
  {
    const STAR_KIND = 'starred_a_message';
    const starRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${STAR_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const starRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${STAR_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const mark = (who, body) => call('/rest/v1/rpc/set_message_mark', { method: 'POST', token: who.token, body: { tool: TOOL, star: null, trash: null, ...body } });
    const [sa, sb] = [await starRows(a), await starRows(b)];
    check('the stars A and B put on a message above recorded one engagement each, worth what the rule says, naming its tool',
      sa.length === 1 && sb.length === 1 && [...sa, ...sb].every((e) => e.points === starRule?.points && e.tool === TOOL && e.task_id === null),
      `A ${JSON.stringify(sa)}, B ${JSON.stringify(sb)}, rule ${starRule?.points}`);
    const again = await mark(b, { message: toBRow?.id, star: true });
    const trashIn = await mark(b, { message: toBRow?.id, trash: true });
    const trashOut = await mark(b, { message: toBRow?.id, trash: false });
    const unstar = await mark(b, { message: toBRow?.id, star: false });
    const sb2 = await starRows(b);
    check('starring a starred message again, the trash in and out, and taking the star off record nothing',
      [again, trashIn, trashOut, unstar].every((r) => r.status === 200) && sb2.length === 1,
      `HTTP ${[again, trashIn, trashOut, unstar].map((r) => r.status).join(',')}, B ${JSON.stringify(sb2)}`);
    const restar = await mark(b, { message: toBRow?.id, star: true, tool: 'rls-check-star-tool' });
    const aNote = await mark(a, { message: toSelfRow?.id, star: true });
    const [sa3, sb3] = [await starRows(a), await starRows(b)];
    check('starring a message that was not starred records exactly one engagement for the member who starred it, naming the tool it sent',
      restar.status === 200 && aNote.status === 200 && sb3.length === 2 && sb3[1].tool === 'rls-check-star-tool' && sb3[1].points === starRule?.points
        && sa3.length === 2 && sa3[1].tool === TOOL,
      `restar HTTP ${restar.status}, A note HTTP ${aNote.status}, A ${JSON.stringify(sa3)}, B ${JSON.stringify(sb3)}`);
    const refused = await mark(b, { message: toSelfRow?.id, star: true });
    const sb4 = await starRows(b);
    check('a refused star (a message B neither sent nor received) records nothing', refused.status >= 400 && sb4.length === 2, `HTTP ${refused.status}, B ${sb4.length}`);
    check('"Starred a message" is active at 1 point with its four factors and a reason for each',
      starRule?.name === 'Starred a message' && starRule.points === 1 && starRule.effort === 0 && starRule.value === 0 && starRule.rarity === 0 && starRule.farm_risk === 3
        && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof starRule[k] === 'string' && starRule[k].length > 0),
      JSON.stringify(starRule));
    const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: STAR_KIND, points: 1, tool: TOOL } });
    const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: STAR_KIND, p_tool: TOOL, p_task: null } });
    const forgeTrigger = await call('/rest/v1/rpc/message_marks_score', { method: 'POST', token: b.token, body: {} });
    const sb5 = await starRows(b);
    check('a member cannot forge a "Starred a message" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
      forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && sb5.length === 2,
      `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, message_marks_score HTTP ${forgeTrigger.status}, B now ${sb5.length}`);
    const aMark = `/rest/v1/message_marks?message_id=eq.${toSelfRow?.id}&member_id=eq.${a.id}`;
    const svcOff = await admin(aMark, { method: 'PATCH', prefer: 'return=representation', body: { starred: false } });
    const svcOn = await admin(aMark, { method: 'PATCH', prefer: 'return=representation', body: { starred: true } });
    const sa6 = await starRows(a);
    check('a star saved with the service key (no signed-in member) is saved and scores nothing',
      svcOff.status < 300 && svcOn.status < 300 && svcOn.json?.[0]?.starred === true && sa6.length === sa3.length,
      `off HTTP ${svcOff.status}, on HTTP ${svcOn.status} ${JSON.stringify(svcOn.json)}, A had ${sa3.length} now ${sa6.length}`);
    starredPointsA = sa6.reduce((sum, e) => sum + e.points, 0);
  }

  // One member may have 20 messages emailed an hour, counting every message
  // they saved in that hour; past that the lookup
  // refuses with WC429 and the message stays saved. B (a viewer) sends 20 to
  // A, each recorded as emailed, then a 21st.
  for (let i = 0; i < 20; i += 1) {
    const sent = await sendRpc(b, { recipient: a.id, subject: `Limit ${i}`, body: 'Hello', tool: TOOL });
    await recordRpc(b, Array.isArray(sent.json) ? sent.json[0]?.id : null, 'sent');
  }
  const overLimit = await sendRpc(b, { recipient: a.id, subject: 'One too many', body: 'Hello', tool: TOOL });
  const overLimitRow = Array.isArray(overLimit.json) ? overLimit.json[0] : null;
  const limited = await lookup({ key: SERVICE }, overLimitRow?.id, b.id);
  const otherSender = await lookup({ key: SERVICE }, toSelfRow?.id, a.id);
  check('past 20 messages sent in an hour, the lookup refuses with WC429 and hands back no address; the message is still saved, and another sender is unaffected', !!overLimitRow?.id && limited.status >= 400 && limited.json?.code === 'WC429' && !JSON.stringify(limited.json ?? '').includes('@') && otherSender.status === 200 && otherSender.json === a.email, `HTTP ${limited.status} ${limited.json?.code ?? ''} ${limited.json?.message ?? ''}; other sender HTTP ${otherSender.status}`);
  // The limit holds when the sends come all at once. A (an admin, with only
  // a few messages so far) fires 30 sends at the same moment, each looked up
  // straight after its own save, as the server does, and none recorded as
  // emailed. At most 20 may get an address back; every other is WC429.
  const burst = await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    const sent = await sendRpc(a, { recipient: b.id, subject: `Burst ${i}`, body: 'Hello', tool: TOOL });
    return lookup({ key: SERVICE }, Array.isArray(sent.json) ? sent.json[0]?.id : null, a.id);
  }));
  const burstEmailed = burst.filter((r) => r.status === 200 && r.json === b.email).length;
  const burstRefused = burst.filter((r) => r.status >= 400 && r.json?.code === 'WC429').length;
  check('30 sends fired at once get at most 20 addresses; every other is refused with WC429', burstEmailed <= 20 && burstEmailed + burstRefused === 30, `${burstEmailed} looked up, ${burstRefused} refused, ${30 - burstEmailed - burstRefused} other`);

  // Every message saved for another member was scored for its sender, inside
  // the same save (messages_score); refused sends and a note to oneself
  // scored nothing. A sent B one, then 30 at once; B sent A 22.
  const MESSAGE_KIND = 'send_a_message_to_another_member';
  const messagePoints = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${MESSAGE_KIND}&select=points`)).json?.[0]?.points;
  const sentTo = async (from, to) => (await admin(`/rest/v1/messages?sender_id=eq.${from.id}&recipient_id=eq.${to.id}&select=id`)).json?.length;
  const scoredFor = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${MESSAGE_KIND}&select=points,tool,task_id`)).json ?? [];
  const [aToB, bToA, aScored, bScored] = [await sentTo(a, b), await sentTo(b, a), await scoredFor(a), await scoredFor(b)];
  check('each message sent to another member records one engagement for its sender, worth what the rule says and naming its tool; a refused send or a note to oneself records none',
    aToB === 31 && bToA === 22 && aScored.length === aToB && bScored.length === bToA && Number.isInteger(messagePoints)
      && [...aScored, ...bScored].every((e) => e.points === messagePoints && e.tool === TOOL && e.task_id === null),
    `A sent B ${aToB}, scored ${aScored.length}; B sent A ${bToA}, scored ${bScored.length}; rule worth ${messagePoints}`);

  // Chats (20261112120000_chats.sql): any two members chat; a chat is made
  // only through start_chat and a message saved only through
  // send_chat_message; a member reads a chat, its members and its messages
  // only when they are in it, an admin included; nobody writes the tables
  // directly; every message saved is scored for its sender in the same save.
  const outsider = await makeUser('chat-outsider');
  const startRpc = (who, body) => call('/rest/v1/rpc/start_chat', { method: 'POST', token: who.token, body });
  const chatRpc = (who, body) => call('/rest/v1/rpc/send_chat_message', { method: 'POST', token: who.token, body });
  const chatAB = await startRpc(b, { other_member: a.id });
  const chatBA = await startRpc(a, { other_member: b.id });
  const chatAgain = await startRpc(b, { other_member: a.id, about_task: null });
  check('start_chat twice for the same pair, in either order, returns the same chat', chatAB.status === 200 && typeof chatAB.json === 'string' && chatBA.json === chatAB.json && chatAgain.json === chatAB.json,
    `HTTP ${chatAB.status} ${JSON.stringify(chatAB.json)}, other way ${JSON.stringify(chatBA.json)}, again ${JSON.stringify(chatAgain.json)}`);
  const chatTask = await startRpc(a, { other_member: b.id, about_task: insA.id });
  const chatTaskAgain = await startRpc(b, { other_member: a.id, about_task: insA.id });
  check('a chat about a task is its own chat, and starting it again from either side finds it', chatTask.status === 200 && chatTask.json !== chatAB.json && chatTaskAgain.json === chatTask.json,
    `HTTP ${chatTask.status} ${JSON.stringify(chatTask.json)}, again ${JSON.stringify(chatTaskAgain.json)}`);
  // Two members starting the same chat at the same moment still make one.
  const raced = await Promise.all([startRpc(a, { other_member: outsider.id }), startRpc(outsider, { other_member: a.id }), startRpc(a, { other_member: outsider.id })]);
  check('starting the same chat three times at once makes one chat', raced.every((r) => r.status === 200 && r.json === raced[0].json), JSON.stringify(raced.map((r) => [r.status, r.json])));
  const selfChat = await startRpc(a, { other_member: a.id });
  const nobodyChat = await startRpc(a, { other_member: randomUUID() });
  const noTaskChat = await startRpc(a, { other_member: b.id, about_task: randomUUID() });
  const anonChat = await call('/rest/v1/rpc/start_chat', { method: 'POST', body: { other_member: a.id } });
  check('the database refuses a chat with yourself, an unknown member, a task you may not read, and a signed-out visitor',
    selfChat.status >= 400 && /yourself/.test(selfChat.json?.message ?? '') && nobodyChat.status >= 400 && /no such member/.test(nobodyChat.json?.message ?? '')
      && noTaskChat.status >= 400 && /no task/.test(noTaskChat.json?.message ?? '') && anonChat.status >= 400,
    `self HTTP ${selfChat.status} ${selfChat.json?.message ?? ''}; unknown HTTP ${nobodyChat.status} ${nobodyChat.json?.message ?? ''}; task HTTP ${noTaskChat.status} ${noTaskChat.json?.message ?? ''}; signed out HTTP ${anonChat.status}`);
  const chatId = chatAB.json;
  const CHAT_KIND = 'sent_a_chat_message';
  const chatScored = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${CHAT_KIND}&select=points,tool,task_id`)).json ?? [];
  const sayB = await chatRpc(b, { chat: chatId, body: '  Hello A \n', tool: TOOL });
  const sayA = await chatRpc(a, { chat: chatId, body: 'Hello B', tool: TOOL });
  check('both members of a chat send a message, each handed back its id', sayB.status === 200 && typeof sayB.json === 'string' && sayA.status === 200 && typeof sayA.json === 'string',
    `B HTTP ${sayB.status} ${JSON.stringify(sayB.json)}, A HTTP ${sayA.status} ${JSON.stringify(sayA.json)}`);
  const intruder = await chatRpc(outsider, { chat: chatId, body: 'Let me in', tool: TOOL });
  const emptyChat = await chatRpc(a, { chat: chatId, body: ' \n\t ', tool: TOOL });
  const longChat = await chatRpc(a, { chat: chatId, body: 'x'.repeat(4001), tool: TOOL });
  const noToolChat = await chatRpc(a, { chat: chatId, body: 'Hi', tool: ' ' });
  const anonSay = await call('/rest/v1/rpc/send_chat_message', { method: 'POST', body: { chat: chatId, body: 'Hi', tool: TOOL } });
  check('the database refuses a message from someone not in the chat, an empty or over-long one, one with no tool, and a signed-out visitor',
    intruder.status >= 400 && /not in that chat/.test(intruder.json?.message ?? '') && emptyChat.status >= 400 && longChat.status >= 400 && /too long/.test(longChat.json?.message ?? '')
      && noToolChat.status >= 400 && anonSay.status >= 400,
    `outsider HTTP ${intruder.status} ${intruder.json?.message ?? ''}; empty HTTP ${emptyChat.status}; long HTTP ${longChat.status}; no tool HTTP ${noToolChat.status}; signed out HTTP ${anonSay.status}`);
  const forgeChatMessage = await call('/rest/v1/chat_messages', { method: 'POST', token: outsider.token, body: { chat_id: chatId, sender_id: a.id, body: 'Forged', tool: TOOL } });
  const forgeChat = await call('/rest/v1/chats', { method: 'POST', token: outsider.token, body: {} });
  const forgeJoin = await call('/rest/v1/chat_members', { method: 'POST', token: outsider.token, body: { chat_id: chatId, member_id: outsider.id } });
  const editChat = await call(`/rest/v1/chat_messages?id=eq.${sayA.json}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { body: 'Changed' } });
  const wipeChat = await call(`/rest/v1/chat_messages?id=eq.${sayA.json}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  const leaveChat = await call(`/rest/v1/chat_members?chat_id=eq.${chatId}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('nobody writes a chat, a chat member or a chat message directly, or changes or deletes one',
    forgeChatMessage.status >= 400 && forgeChat.status >= 400 && forgeJoin.status >= 400
      && (editChat.status >= 400 || editChat.json?.length === 0) && (wipeChat.status >= 400 || wipeChat.json?.length === 0) && (leaveChat.status >= 400 || leaveChat.json?.length === 0),
    `message HTTP ${forgeChatMessage.status}, chat HTTP ${forgeChat.status}, join HTTP ${forgeJoin.status}, edit HTTP ${editChat.status}, delete HTTP ${wipeChat.status}, leave HTTP ${leaveChat.status}`);
  const chatReadB = await call(`/rest/v1/chat_messages?chat_id=eq.${chatId}&select=sender_id,body,tool&order=created_at`, { token: b.token });
  const membersB = await call(`/rest/v1/chat_members?chat_id=eq.${chatId}&select=member_id`, { token: b.token });
  check('a member of the chat reads both messages, saved trimmed, and both members', JSON.stringify(chatReadB.json) === JSON.stringify([{ sender_id: b.id, body: 'Hello A', tool: TOOL }, { sender_id: a.id, body: 'Hello B', tool: TOOL }])
      && (membersB.json ?? []).map((m) => m.member_id).sort().join() === [a.id, b.id].sort().join(),
    `messages ${JSON.stringify(chatReadB.json)}, members ${JSON.stringify(membersB.json)}`);
  const outChats = await call(`/rest/v1/chats?id=in.(${chatId},${chatTask.json})&select=id`, { token: outsider.token });
  const outMembers = await call(`/rest/v1/chat_members?chat_id=in.(${chatId},${chatTask.json})&select=member_id`, { token: outsider.token });
  const outMessages = await call(`/rest/v1/chat_messages?chat_id=eq.${chatId}&select=body`, { token: outsider.token });
  const outAll = await call('/rest/v1/chat_messages?select=chat_id', { token: outsider.token });
  const anonRead = await call('/rest/v1/chat_messages?select=body');
  check('a member outside a chat reads nothing from it: not the chat, not who is in it, not one message; a signed-out visitor reads none',
    outChats.json?.length === 0 && outMembers.json?.length === 0 && outMessages.json?.length === 0 && (outAll.json ?? []).every((m) => m.chat_id === raced[0].json)
      && (anonRead.status >= 400 || anonRead.json?.length === 0),
    `chats ${JSON.stringify(outChats.json)}, members ${JSON.stringify(outMembers.json)}, messages ${JSON.stringify(outMessages.json)}, all ${JSON.stringify(outAll.json)}, signed out HTTP ${anonRead.status}`);
  // A chat about a task stays one after the task is deleted
  // (20261113120000_chats_about_a_task.sql): it keeps about_a_task, and a
  // plain chat between the same two is a new chat, not the old task chat.
  const goneTask = await createTask(outsider.store, { title: 'Task deleted under a chat', points: 1 }, TOOL);
  const goneChat = await startRpc(outsider, { other_member: b.id, about_task: goneTask.id });
  const goneDelete = await admin(`/rest/v1/tasks?id=eq.${goneTask.id}`, { method: 'DELETE', prefer: 'return=representation', tool: TOOL });
  const goneChatRow = await call(`/rest/v1/chats?id=eq.${goneChat.json}&select=task_id,about_a_task`, { token: b.token });
  const plainAfter = await startRpc(b, { other_member: outsider.id });
  const plainAgain = await startRpc(outsider, { other_member: b.id, about_task: null });
  check('a chat about a deleted task still says it was about a task, and a plain chat between the same two is a separate chat',
    goneChat.status === 200 && Array.isArray(goneDelete.json) && goneDelete.json.length === 1
      && JSON.stringify(goneChatRow.json) === JSON.stringify([{ task_id: null, about_a_task: true }])
      && plainAfter.status === 200 && plainAfter.json !== goneChat.json && plainAgain.json === plainAfter.json,
    `chat HTTP ${goneChat.status}, delete HTTP ${goneDelete.status} ${JSON.stringify(goneDelete.json)}, row ${JSON.stringify(goneChatRow.json)}, plain ${JSON.stringify(plainAfter.json)} again ${JSON.stringify(plainAgain.json)}`);
  const plainRow = await call(`/rest/v1/chats?id=in.(${chatId},${chatTask.json})&select=id,about_a_task`, { token: a.token });
  check('a plain chat is marked as not about a task, and a task chat as about one',
    (plainRow.json ?? []).find((c) => c.id === chatId)?.about_a_task === false && (plainRow.json ?? []).find((c) => c.id === chatTask.json)?.about_a_task === true,
    JSON.stringify(plainRow.json));
  const chatRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${CHAT_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
  const [chatA, chatB, chatOut] = [await chatScored(a), await chatScored(b), await chatScored(outsider)];
  check('each chat message saved records one engagement for its sender, worth what the rule says and naming its tool; a refused one records none',
    chatA.length === 1 && chatB.length === 1 && chatOut.length === 0 && [...chatA, ...chatB].every((e) => e.points === chatRule?.points && e.tool === TOOL && e.task_id === null),
    `A ${JSON.stringify(chatA)}, B ${JSON.stringify(chatB)}, outsider ${JSON.stringify(chatOut)}, rule ${chatRule?.points}`);
  check('"Sent a chat message" is listed at 4 points with its four factors and a reason for each',
    chatRule?.name === 'Sent a chat message' && chatRule.points === 4 && chatRule.effort === 1 && chatRule.value === 1 && chatRule.rarity === 0 && chatRule.farm_risk === 2
      && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof chatRule[k] === 'string' && chatRule[k].length > 0),
    JSON.stringify(chatRule));
  // Starting a chat earns its point (20261123130000_score_started_a_chat.sql,
  // WC-189): a new chat is scored once for the member who started it, naming
  // the tool from the x-wavecenter-tool header ('supabase-api' when none is
  // sent); opening a chat already there, a refused start and a service-key
  // insert score nothing; nobody can write the engagement themselves.
  let startedChatPointsA = 0;
  {
    const STARTED_KIND = 'started_a_chat';
    const startedRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${STARTED_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const named = await call('/rest/v1/rpc/start_chat', { method: 'POST', token: b.token, body: { other_member: outsider.id, about_task: insA.id }, tool: 'rls-check-chat-tool' });
    const made = [chatAB.json, chatTask.json, raced[0].json, goneChat.json, plainAfter.json, named.json];
    const makers = (await admin(`/rest/v1/chats?id=in.(${made.join(',')})&select=id,created_by`)).json ?? [];
    const startedRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${STARTED_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const [sa, sb, so] = [await startedRows(a), await startedRows(b), await startedRows(outsider)];
    const madeBy = (m) => makers.filter((c) => c.created_by === m.id).length;
    check('starting a new chat records one engagement for the member who started it, worth what the rule says; opening one already there or a refused start records none',
      named.status === 200 && makers.length === 6 && sa.length === madeBy(a) && sb.length === madeBy(b) && so.length === madeBy(outsider)
        && sb.length === 3 && sa.length + so.length === 3
        && [...sa, ...sb, ...so].every((e) => e.points === startedRule?.points && e.task_id === null),
      `A ${JSON.stringify(sa)}, B ${JSON.stringify(sb)}, outsider ${JSON.stringify(so)}, chats ${JSON.stringify(makers)}, rule ${startedRule?.points}`);
    check('a new chat names the tool its caller sent, and "supabase-api" when none was sent',
      JSON.stringify(sb.map((e) => e.tool)) === JSON.stringify(['supabase-api', 'supabase-api', 'rls-check-chat-tool']) && [...sa, ...so].every((e) => e.tool === 'supabase-api'),
      JSON.stringify(sb.map((e) => e.tool)));
    check('"Started a chat" is active at 1 point with its four factors and a reason for each',
      startedRule?.name === 'Started a chat' && startedRule.points === 1 && startedRule.effort === 0 && startedRule.value === 1 && startedRule.rarity === 1 && startedRule.farm_risk === 2
        && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof startedRule[k] === 'string' && startedRule[k].length > 0),
      JSON.stringify(startedRule));
    const forgeStarted = await call('/rest/v1/engagements', { method: 'POST', token: outsider.token, body: { member_id: outsider.id, kind: STARTED_KIND, points: 1, tool: TOOL } });
    const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: outsider.token, body: { p_member: outsider.id, p_kind: STARTED_KIND, p_tool: TOOL, p_task: null } });
    const forgeTrigger = await call('/rest/v1/rpc/chats_score', { method: 'POST', token: outsider.token, body: {} });
    const soAfter = await startedRows(outsider);
    check('a member cannot forge a "Started a chat" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
      forgeStarted.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && soAfter.length === so.length,
      `ledger HTTP ${forgeStarted.status}, record_engagement HTTP ${forgeRecord.status}, chats_score HTTP ${forgeTrigger.status}, outsider now ${soAfter.length}`);
    const svcChat = await admin('/rest/v1/chats', { method: 'POST', prefer: 'return=representation', body: { created_by: a.id } });
    const saAfter = await startedRows(a);
    check('a chat made with the service key (no signed-in member) is saved and scores nothing',
      svcChat.status === 201 && Array.isArray(svcChat.json) && svcChat.json.length === 1 && saAfter.length === sa.length,
      `HTTP ${svcChat.status} ${JSON.stringify(svcChat.json)}, A had ${sa.length} now ${saAfter.length}`);
    if (svcChat.json?.[0]?.id) await admin(`/rest/v1/chats?id=eq.${svcChat.json[0].id}`, { method: 'DELETE' });
    startedChatPointsA = sa.reduce((sum, e) => sum + e.points, 0);
  }

  // Unread chat messages (20261113150000_chat_unread.sql): a message is
  // unread for a member when it is newer than their last read and not their
  // own; only the member marks a chat read, for themselves alone.
  const unreadIn = async (who) => {
    const r = await call('/rest/v1/rpc/my_chat_unread', { method: 'POST', token: who.token, body: {} });
    return { status: r.status, count: (Array.isArray(r.json) ? r.json : []).find((row) => row.chat_id === chatId)?.unread ?? 0, rows: r.json };
  };
  const markRpc = (who, chat) => call('/rest/v1/rpc/mark_chat_read', { method: 'POST', token: who.token, body: { chat } });
  const [unreadA0, unreadB0] = [await unreadIn(a), await unreadIn(b)];
  check('each member of a chat has the other\'s message unread, never their own', unreadA0.status === 200 && unreadA0.count === 1 && unreadB0.status === 200 && unreadB0.count === 1,
    `A ${JSON.stringify(unreadA0)}, B ${JSON.stringify(unreadB0)}`);
  const markA = await markRpc(a, chatId);
  const [unreadA1, unreadB1] = [await unreadIn(a), await unreadIn(b)];
  const readRows = (await admin(`/rest/v1/chat_members?chat_id=eq.${chatId}&select=member_id,last_read_at`)).json ?? [];
  const readOf = (member) => readRows.find((r) => r.member_id === member.id)?.last_read_at;
  check('marking a chat read clears it for that member alone, and records it on their own row only',
    markA.status === 200 && typeof markA.json === 'string' && unreadA1.count === 0 && unreadB1.count === 1 && readOf(a) && readOf(b) === null,
    `mark HTTP ${markA.status} ${JSON.stringify(markA.json)}, A ${unreadA1.count}, B ${unreadB1.count}, rows ${JSON.stringify(readRows)}`);
  const markOut = await markRpc(outsider, chatId);
  const markAnon = await call('/rest/v1/rpc/mark_chat_read', { method: 'POST', body: { chat: chatId } });
  const forgeRead = await call(`/rest/v1/chat_members?chat_id=eq.${chatId}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { last_read_at: new Date().toISOString() } });
  const readRowsAfter = (await admin(`/rest/v1/chat_members?chat_id=eq.${chatId}&select=member_id,last_read_at`)).json ?? [];
  check('nobody else marks a chat read: not a member outside it, not a signed-out visitor, and nobody writes last_read_at directly',
    markOut.status >= 400 && /not in that chat/.test(markOut.json?.message ?? '') && markAnon.status >= 400
      && (forgeRead.status >= 400 || (Array.isArray(forgeRead.json) && forgeRead.json.length === 0))
      && readRowsAfter.find((r) => r.member_id === b.id)?.last_read_at === null,
    `outsider HTTP ${markOut.status} ${markOut.json?.message ?? ''}, signed out HTTP ${markAnon.status}, direct HTTP ${forgeRead.status} ${JSON.stringify(forgeRead.json)}`);
  const unreadOut = await call('/rest/v1/rpc/my_chat_unread', { method: 'POST', token: outsider.token, body: {} });
  check('a member outside a chat never sees an unread count for it',
    unreadOut.status === 200 && (unreadOut.json ?? []).every((row) => row.chat_id !== chatId), `HTTP ${unreadOut.status} ${JSON.stringify(unreadOut.json)}`);
  await chatRpc(b, { chat: chatId, body: 'Are you there?', tool: TOOL });
  const unreadA2 = await unreadIn(a);
  check('a newer message after a member read the chat counts as unread again', unreadA2.count === 1, JSON.stringify(unreadA2));
  const readScored = (await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=like.*read*&select=kind`)).json ?? [];
  check('marking a chat read scores nothing', readScored.length === 0, JSON.stringify(readScored));

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
  // Making a team is scored by the table's trigger: once, for its maker.
  const madeTeamA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_a_team&select=points,tool,task_id`);
  check('making a team records one engagement, credited to its maker, naming the tool, and a refused team records none',
    JSON.stringify(madeTeamA.json) === JSON.stringify([{ points: 1, tool: TOOL, task_id: null }]), JSON.stringify(madeTeamA.json));
  await addTeamMember(teamDeps(a), { actorId: a.id, teamId: teamA.id, memberId: a.id }, TOOL);
  await addTeamMember(teamDeps(a), { actorId: a.id, teamId: teamA.id, memberId: b.id }, TOOL);
  const addedA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.added_a_member_to_a_team&select=points,tool,task_id`);
  const addedB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.added_a_member_to_a_team&select=id`);
  check('adding a member to a team scores 1 for the member who added them, never the member added, naming the tool',
    addedA.json?.length === 2 && addedA.json.every((e) => e.points === 1 && e.tool === TOOL && e.task_id === null) && addedB.json?.length === 0,
    `A ${JSON.stringify(addedA.json)}, B ${JSON.stringify(addedB.json)}`);

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
  const madeTeamB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.made_a_team&select=id`);
  check('a team that was refused records no engagement', madeTeamB.json?.length === 0, JSON.stringify(madeTeamB.json));
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
  // Changing a team earns the member who changed it one point (teams_score_change);
  // a save that changes nothing earns none.
  await updateTeam(teamDeps(b), { actorId: b.id, teamId: teamA.id, name: 'RLS check team', slug, description: 'Changed by an editor.' }, TOOL);
  const teamScoreB = await call(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.changed_a_team&select=member_id,points,tool,task_id`, { token: b.token });
  const teamScoreA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.changed_a_team&select=id`);
  check('changing a team records one engagement for the member who changed it, from the rules, naming its tool; an unchanged save records none',
    teamScoreB.json?.length === 1 && teamScoreB.json[0].points === 1 && teamScoreB.json[0].tool === TOOL && teamScoreB.json[0].task_id === null && teamScoreA.json?.length === 0,
    `B ${JSON.stringify(teamScoreB.json)}, A ${JSON.stringify(teamScoreA.json)}`);
  await removeTeamMember(teamDeps(b), { actorId: b.id, teamId: teamA.id, memberId: b.id }, 'rls-check-remover');
  check('an editor removes a member from a team', !(await teamStore(a).hasMember(teamA.id, b.id)), 'B is still on the team');
  await deleteTeam(teamDeps(b), { actorId: b.id, teamId: teamA.id }, TOOL);
  // B removed one member; deleting the team then took A's link with it, which is not a removal of its own.
  const removedB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.removed_a_member_from_a_team&select=points,tool,task_id`);
  const removedA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.removed_a_member_from_a_team&select=id`);
  check('removing a member from a team scores 1 for the member who removed them, naming the tool; deleting the team scores no removal',
    removedB.json?.length === 1 && removedB.json[0].points === 1 && removedB.json[0].tool === 'rls-check-remover' && removedB.json[0].task_id === null && removedA.json?.length === 0,
    `B ${JSON.stringify(removedB.json)}, A ${JSON.stringify(removedA.json)}`);
  const goneTeam = await admin(`/rest/v1/teams?id=eq.${teamA.id}&select=id`);
  const goneLinks = await admin(`/rest/v1/team_members?team_id=eq.${teamA.id}&select=member_id`);
  const stillA2 = await admin(`/auth/v1/admin/users/${a.id}`);
  check('deleting a team removes its member links and no member account', goneTeam.json?.length === 0 && goneLinks.json?.length === 0 && stillA2.status === 200, `team ${JSON.stringify(goneTeam.json)}, links ${JSON.stringify(goneLinks.json)}, A HTTP ${stillA2.status}`);
  // Deleting a team is scored by the table's trigger: once, for whoever deleted it (B, not its maker A), naming the tool; B's refused delete as a viewer earned nothing.
  const deletedTeamB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.deleted_a_team&select=points,tool,task_id`);
  const deletedTeamA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.deleted_a_team&select=id`);
  check('deleting a team records one engagement, credited to the member who deleted it, naming the tool, and a refused delete records none',
    JSON.stringify(deletedTeamB.json) === JSON.stringify([{ points: 1, tool: TOOL, task_id: null }]) && deletedTeamA.json?.length === 0,
    `B ${JSON.stringify(deletedTeamB.json)}, A ${JSON.stringify(deletedTeamA.json)}`);
  await setMemberRole(roleStore(a), { actorId: a.id, memberId: b.id, role: 'viewer' }, TOOL);

  // Meetings (20261123120000_meetings.sql, WC-204): every role that views
  // teams reads every meeting and who is invited; only a member of the
  // meeting's team (Dane, "B") makes, changes or deletes it and invites
  // anyone, through core or straight at the tables. A is an admin and B a
  // viewer; A is on the team, B starts off it.
  {
    const meetingStore = (member) => {
      const fromRow = (r) => r && {
        id: r.id, teamId: r.team_id, title: r.title, date: r.meets_on, startTime: String(r.start_time ?? '').slice(0, 5),
        venue: r.venue, notes: r.notes, tool: r.tool, createdAt: r.created_at, createdBy: r.created_by,
      };
      const toRow = (f, tool) => ({ title: f.title, meets_on: f.date, start_time: f.startTime, venue: f.venue, notes: f.notes, tool });
      const sure = (got, what) => {
        if (got.status >= 300) throw new Error(`meetings ${what} failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
        return Array.isArray(got.json) ? got.json : [];
      };
      const opts = (method, body) => ({ method, token: member.token, prefer: 'return=representation', body });
      return {
        async get(id) { return fromRow(sure(await call(`/rest/v1/meetings?id=eq.${id}`, { token: member.token }), 'read')[0]) ?? null; },
        async insert(teamId, f, tool) { return fromRow(sure(await call('/rest/v1/meetings', opts('POST', { team_id: teamId, ...toRow(f, tool) })), 'insert')[0]) ?? null; },
        async update(id, f, tool) { return fromRow(sure(await call(`/rest/v1/meetings?id=eq.${id}`, opts('PATCH', toRow(f, tool))), 'update')[0]) ?? null; },
        async remove(id) { return sure(await call(`/rest/v1/meetings?id=eq.${id}`, opts('DELETE')), 'delete').length > 0; },
        async invitees(id) { return sure(await call(`/rest/v1/meeting_invites?meeting_id=eq.${id}&select=member_id`, { token: member.token }), 'invites read').map((r) => r.member_id); },
        async invite(id, memberId, tool) { return sure(await call('/rest/v1/meeting_invites', opts('POST', { meeting_id: id, member_id: memberId, tool })), 'invite').length > 0; },
        async uninvite(id, memberId) { return sure(await call(`/rest/v1/meeting_invites?meeting_id=eq.${id}&member_id=eq.${memberId}`, opts('DELETE')), 'uninvite').length > 0; },
      };
    };
    const meetingDeps = (member) => ({ meetings: meetingStore(member), teams: teamStore(member) });
    // The teams and their member lists are set up with the service key, so
    // nothing here is scored and the points tallies later in this script hold.
    const meetSlug = `rls-meet-${randomUUID().slice(0, 8)}`;
    const madeTeams = await admin('/rest/v1/teams', { method: 'POST', prefer: 'return=representation', body: [
      { name: 'RLS meeting team', slug: meetSlug, tool: TOOL }, { name: 'RLS other team', slug: `${meetSlug}-o`, tool: TOOL },
    ] });
    if (madeTeams.status >= 300 || madeTeams.json?.length !== 2) throw new Error(`could not make the meeting check's teams: HTTP ${madeTeams.status} ${JSON.stringify(madeTeams.json)}`);
    const [meetTeam, otherTeam] = madeTeams.json;
    teamIds.push(meetTeam.id, otherTeam.id);
    const putOnTeam = async (memberId) => {
      const got = await admin('/rest/v1/team_members', { method: 'POST', body: { team_id: meetTeam.id, member_id: memberId, tool: TOOL } });
      if (got.status >= 300) throw new Error(`could not put a member on the meeting check's team: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    };
    await putOnTeam(a.id);
    const plan = { title: 'RLS kickoff', date: '2026-12-01', startTime: '10:00', venue: 'Zoom', notes: null };

    const made = await createMeeting(meetingDeps(a), { actorId: a.id, teamId: meetTeam.id, ...plan }, TOOL);
    check('a member of a team plans its meeting through core; the database stamps who and keeps the Mountain date and time as typed',
      made.teamId === meetTeam.id && made.createdBy === a.id && made.tool === TOOL && made.date === '2026-12-01' && made.startTime === '10:00' && made.venue === 'Zoom',
      JSON.stringify(made));
    const forgedMaker = await call('/rest/v1/meetings', { method: 'POST', token: a.token, prefer: 'return=representation', body: { team_id: meetTeam.id, title: 'Forged', meets_on: '2026-12-02', start_time: '09:00', created_by: b.id } });
    check('nobody can record someone else as a meeting’s maker', forgedMaker.status >= 400, `HTTP ${forgedMaker.status} ${JSON.stringify(forgedMaker.json)}`);
    const offTeamA = await call('/rest/v1/meetings', { method: 'POST', token: a.token, body: { team_id: otherTeam.id, title: 'Not mine', meets_on: '2026-12-02', start_time: '09:00' } });
    check('even an admin cannot plan a meeting for a team they are not on, straight at the table', offTeamA.status >= 400, `HTTP ${offTeamA.status} ${offTeamA.json?.message ?? ''}`);
    const moved = await call(`/rest/v1/meetings?id=eq.${made.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { team_id: otherTeam.id } });
    check('a meeting cannot be moved to another team', moved.status >= 400, `HTTP ${moved.status} ${JSON.stringify(moved.json)}`);

    const readB = await call(`/rest/v1/meetings?id=eq.${made.id}&select=title`, { token: b.token });
    check('a viewer who is not on the team still sees its meeting', readB.status === 200 && readB.json?.[0]?.title === 'RLS kickoff', `HTTP ${readB.status} ${JSON.stringify(readB.json)}`);
    const viaCoreB = await createMeeting(meetingDeps(b), { actorId: b.id, teamId: meetTeam.id, ...plan }, TOOL).then(() => '', (e) => e.message);
    check('someone not on the team cannot plan its meeting through core', /Only a member of this team/.test(viaCoreB), viaCoreB || 'the meeting was made');
    const forgedB = await call('/rest/v1/meetings', { method: 'POST', token: b.token, body: { team_id: meetTeam.id, title: 'Sneaky', meets_on: '2026-12-03', start_time: '09:00' } });
    check('someone not on the team cannot plan its meeting straight at the table', forgedB.status >= 400, `HTTP ${forgedB.status} ${forgedB.json?.message ?? ''}`);
    const renameB = await call(`/rest/v1/meetings?id=eq.${made.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { title: 'Hijacked' } });
    const dropB = await call(`/rest/v1/meetings?id=eq.${made.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
    check('someone not on the team cannot change or delete its meeting',
      (renameB.status >= 400 || renameB.json?.length === 0) && (dropB.status >= 400 || dropB.json?.length === 0),
      `change HTTP ${renameB.status} ${JSON.stringify(renameB.json)}, delete HTTP ${dropB.status} ${JSON.stringify(dropB.json)}`);

    const invited = await setMeetingInvites(meetingDeps(a), { actorId: a.id, meetingId: made.id, memberIds: [b.id] }, TOOL);
    const inviteRow = await admin(`/rest/v1/meeting_invites?meeting_id=eq.${made.id}&select=member_id,invited_by,tool`);
    check('a team member invites someone who is not on the team; the database stamps who invited them',
      invited.length === 1 && invited[0] === b.id && JSON.stringify(inviteRow.json) === JSON.stringify([{ member_id: b.id, invited_by: a.id, tool: TOOL }]),
      `${JSON.stringify(invited)} ${JSON.stringify(inviteRow.json)}`);
    const seenByB = await call(`/rest/v1/meeting_invites?meeting_id=eq.${made.id}&select=member_id`, { token: b.token });
    check('a viewer sees who is invited', seenByB.status === 200 && seenByB.json?.length === 1, `HTTP ${seenByB.status} ${JSON.stringify(seenByB.json)}`);
    const selfInvite = await call('/rest/v1/meeting_invites', { method: 'POST', token: b.token, body: { meeting_id: made.id, member_id: a.id } });
    const unInviteB = await call(`/rest/v1/meeting_invites?meeting_id=eq.${made.id}&member_id=eq.${b.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
    check('someone not on the team cannot invite or uninvite, straight at the table',
      selfInvite.status >= 400 && (unInviteB.status >= 400 || unInviteB.json?.length === 0),
      `invite HTTP ${selfInvite.status}, uninvite HTTP ${unInviteB.status} ${JSON.stringify(unInviteB.json)}`);

    const anonMeetings = await call('/rest/v1/meetings?select=id');
    const anonInvites = await call('/rest/v1/meeting_invites?select=meeting_id');
    check('a signed-out visitor sees no meetings and no invitations',
      (anonMeetings.status >= 400 || anonMeetings.json?.length === 0) && (anonInvites.status >= 400 || anonInvites.json?.length === 0),
      `meetings HTTP ${anonMeetings.status}, invites HTTP ${anonInvites.status}`);

    // Put B on the team: any member of it may now change the meeting, whatever their role.
    await putOnTeam(b.id);
    const changedB = await updateMeeting(meetingDeps(b), { actorId: b.id, meetingId: made.id, ...plan, venue: 'Google Meet' }, TOOL);
    check('a viewer who is on the team changes its meeting through core', changedB.venue === 'Google Meet', JSON.stringify(changedB));
    const keptA = await setMeetingInvites(meetingDeps(b), { actorId: b.id, meetingId: made.id, memberIds: [a.id] }, TOOL);
    check('a team member changes who is invited', keptA.length === 1 && keptA[0] === a.id, JSON.stringify(keptA));
    await deleteMeeting(meetingDeps(b), { actorId: b.id, meetingId: made.id }, TOOL);
    const goneMeeting = await admin(`/rest/v1/meetings?id=eq.${made.id}&select=id`);
    const goneInvites = await admin(`/rest/v1/meeting_invites?meeting_id=eq.${made.id}&select=member_id`);
    check('a team member deletes the meeting, and its invitations go with it', goneMeeting.json?.length === 0 && goneInvites.json?.length === 0,
      `meeting ${JSON.stringify(goneMeeting.json)}, invites ${JSON.stringify(goneInvites.json)}`);

    const second = await createMeeting(meetingDeps(a), { actorId: a.id, teamId: meetTeam.id, ...plan }, TOOL);
    await admin(`/rest/v1/teams?id=in.(${meetTeam.id},${otherTeam.id})`, { method: 'DELETE' });
    const cascaded = await admin(`/rest/v1/meetings?id=eq.${second.id}&select=id`);
    check('deleting a team takes its meetings with it', cascaded.json?.length === 0, JSON.stringify(cascaded.json));
  }

  // Home's boxes (20261102130000_home_boxes.sql): every member reads their
  // words; only a role with home.edit (admin; A is one, B a viewer) changes
  // them, through core or straight at the table. This may run against the
  // live database, so the words Home had are put back afterwards.
  const homeBefore = (await admin('/rest/v1/home_boxes?select=box,body,tool')).json;
  if (!Array.isArray(homeBefore)) throw new Error(`could not read Home's boxes before checking them: ${JSON.stringify(homeBefore)}`);
  try {
    const boxDeps = (member) => ({ boxes: homeBoxStore(member), roles: roleStore(member) });
    const words = `Written by **check_tasks_rls** ${randomUUID().slice(0, 8)}.`;
    const savedA = await saveHomeBox(boxDeps(a), { actorId: a.id, box: 'about', body: words }, TOOL);
    check('an admin changes a Home box through core, and the database stamps who and the tool', savedA.body === words && savedA.tool === TOOL && savedA.updatedBy === a.id, JSON.stringify(savedA));
    const readB = await call('/rest/v1/home_boxes?box=eq.about&select=body', { token: b.token });
    check('a viewer reads the words in Home’s boxes', readB.status === 200 && readB.json?.[0]?.body === words, `HTTP ${readB.status} ${JSON.stringify(readB.json)}`);
    const viaCore = await saveHomeBox(boxDeps(b), { actorId: b.id, box: 'about', body: 'Hijacked' }, TOOL).then(() => '', (e) => e.message);
    check('a viewer cannot change a Home box through core', /may not change the words on Home/.test(viaCore), viaCore || 'the words were changed');
    const patchB = await call('/rest/v1/home_boxes?box=eq.about', { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { body: 'Hijacked' } });
    const upsertB = await call('/rest/v1/home_boxes?on_conflict=box', { method: 'POST', token: b.token, prefer: 'resolution=merge-duplicates', body: { box: 'about', body: 'Hijacked', tool: TOOL } });
    const insertB = await call('/rest/v1/home_boxes', { method: 'POST', token: b.token, body: { box: 'deo', body: 'Hijacked', tool: TOOL } });
    const afterB = await admin('/rest/v1/home_boxes?select=box,body');
    const hijacked = (afterB.json ?? []).some?.((r) => r.body === 'Hijacked');
    check('a viewer cannot change or add a Home box straight at the table', (patchB.status >= 400 || patchB.json?.length === 0) && upsertB.status >= 400 && insertB.status >= 400 && !hijacked,
      `patch HTTP ${patchB.status} ${JSON.stringify(patchB.json)}, upsert HTTP ${upsertB.status}, insert HTTP ${insertB.status}, rows ${JSON.stringify(afterB.json)}`);
    const forgedBy = await call('/rest/v1/home_boxes?on_conflict=box', { method: 'POST', token: a.token, prefer: 'resolution=merge-duplicates', body: { box: 'about', body: words, tool: TOOL, updated_by: b.id } });
    check('nobody can record someone else as the one who changed a box', forgedBy.status >= 400, `HTTP ${forgedBy.status} ${forgedBy.json?.message ?? ''}`);
    const otherBox = await call('/rest/v1/home_boxes', { method: 'POST', token: a.token, body: { box: 'leaderboard', body: 'x', tool: TOOL } });
    const emptyBox = await call('/rest/v1/home_boxes?on_conflict=box', { method: 'POST', token: a.token, prefer: 'resolution=merge-duplicates', body: { box: 'about', body: ' \n ', tool: TOOL } });
    check('the database refuses a box that is not editable and words that are only spaces', otherBox.status >= 400 && emptyBox.status >= 400, `other HTTP ${otherBox.status}, empty HTTP ${emptyBox.status}`);
    const anonBoxes = await call('/rest/v1/home_boxes?select=box');
    check('a signed-out visitor sees no Home box words', anonBoxes.status >= 400 || anonBoxes.json?.length === 0, `HTTP ${anonBoxes.status} ${JSON.stringify(anonBoxes.json)}`);
  } finally {
    await admin('/rest/v1/home_boxes?box=in.(about,deo)', { method: 'DELETE' });
    if (homeBefore.length) await admin('/rest/v1/home_boxes', { method: 'POST', body: homeBefore });
    const restored = (await admin('/rest/v1/home_boxes?select=box,body,tool&order=box')).json;
    const want = [...homeBefore].sort((x, y) => x.box.localeCompare(y.box));
    check('Home’s boxes are put back as they were', JSON.stringify(restored) === JSON.stringify(want), `before ${JSON.stringify(want)}, after ${JSON.stringify(restored)}`);
  }

  // Changing a Home box earns its point
  // (20261123190000_score_changed_a_home_box.sql, WC-195): a save that
  // changes a box's words is scored once for the member who saved it, naming
  // the row's tool; the same words again, a refused save and a service-key
  // save score nothing; nobody can write the engagement themselves. The block
  // above saved one change as A, so A already has one. Home's words are put
  // back as they were afterwards.
  let homeBoxPointsA = 0;
  {
    const HOME_KIND = 'changed_a_home_box';
    const homeRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${HOME_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const homeRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${HOME_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const before = (await admin('/rest/v1/home_boxes?select=box,body,tool')).json;
    if (!Array.isArray(before)) throw new Error(`could not read Home's boxes before scoring them: ${JSON.stringify(before)}`);
    const upsert = (token, body) => call('/rest/v1/home_boxes?on_conflict=box', { method: 'POST', token, prefer: 'resolution=merge-duplicates,return=representation', body });
    try {
      const [ha, hb] = [await homeRows(a), await homeRows(b)];
      check('the Home box change A saved above recorded one engagement for A, worth what the rule says, naming its tool, and none for B',
        ha.length === 1 && hb.length === 0 && ha[0].points === homeRule?.points && ha[0].tool === TOOL && ha[0].task_id === null,
        `A ${JSON.stringify(ha)}, B ${JSON.stringify(hb)}, rule ${homeRule?.points}`);
      const words = `Scored by **check_tasks_rls** ${randomUUID().slice(0, 8)}.`;
      const saved = await saveHomeBox({ boxes: homeBoxStore(a), roles: roleStore(a) }, { actorId: a.id, box: 'deo', body: words }, TOOL);
      const again = await upsert(a.token, { box: 'deo', body: words, tool: 'rls-check-home-tool' });
      const ha2 = await homeRows(a);
      check('changing a Home box records exactly one engagement for the member who saved it; saving the same words again records none',
        saved.body === words && again.status < 300 && ha2.length === 2 && ha2[1].tool === TOOL && ha2[1].points === homeRule?.points,
        `same-words HTTP ${again.status}, A ${JSON.stringify(ha2)}`);
      const changed = await upsert(a.token, { box: 'deo', body: `${words} Changed.`, tool: 'rls-check-home-tool' });
      const refused = await upsert(b.token, { box: 'deo', body: 'Hijacked', tool: TOOL });
      const [ha3, hb3] = [await homeRows(a), await homeRows(b)];
      check('a change straight at the table names the tool it sent; a viewer\u2019s refused save records nothing',
        changed.status < 300 && ha3.length === 3 && ha3[2].tool === 'rls-check-home-tool' && refused.status >= 400 && hb3.length === 0,
        `changed HTTP ${changed.status}, refused HTTP ${refused.status}, A ${JSON.stringify(ha3)}, B ${JSON.stringify(hb3)}`);
      check('"Changed a Home box" is active at 1 point with its four factors and a reason for each',
        homeRule?.name === 'Changed a Home box' && homeRule.points === 1 && homeRule.effort === 1 && homeRule.value === 2 && homeRule.rarity === 1 && homeRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof homeRule[k] === 'string' && homeRule[k].length > 0),
        JSON.stringify(homeRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: HOME_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: HOME_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/home_boxes_score', { method: 'POST', token: b.token, body: {} });
      const hb4 = await homeRows(b);
      check('a member cannot forge a "Changed a Home box" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && hb4.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, home_boxes_score HTTP ${forgeTrigger.status}, B now ${hb4.length}`);
      const svc = await admin('/rest/v1/home_boxes?on_conflict=box', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { box: 'deo', body: `${words} By the service key.`, tool: TOOL } });
      const ha5 = await homeRows(a);
      check('a Home box saved with the service key (no signed-in member) is saved and scores nothing',
        svc.status < 300 && svc.json?.[0]?.body === `${words} By the service key.` && ha5.length === ha3.length,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${ha3.length} now ${ha5.length}`);
      homeBoxPointsA = ha5.reduce((sum, e) => sum + e.points, 0);
    } finally {
      await admin('/rest/v1/home_boxes?box=in.(about,deo)', { method: 'DELETE' });
      if (before.length) await admin('/rest/v1/home_boxes', { method: 'POST', body: before });
      const restored = (await admin('/rest/v1/home_boxes?select=box,body,tool&order=box')).json;
      const want = [...before].sort((x, y) => x.box.localeCompare(y.box));
      check('Home\u2019s boxes are put back as they were after scoring them', JSON.stringify(restored) === JSON.stringify(want), `before ${JSON.stringify(want)}, after ${JSON.stringify(restored)}`);
    }
  }

  // Token sizes (20261103150000_token_settings.sql): every member reads them;
  // only a role with game.edit (admin; A is one, B a viewer) adds, changes or
  // removes one, through core or straight at the table. This may run against
  // the live database, so the sizes are put back as they were afterwards.
  const TOKEN_COLUMNS = 'id,name,diameter,color,min_points,tool';
  const tokensBefore = (await admin(`/rest/v1/token_sizes?select=${TOKEN_COLUMNS}&order=min_points`)).json;
  if (!Array.isArray(tokensBefore)) throw new Error(`could not read the token sizes before checking them: ${JSON.stringify(tokensBefore)}`);
  // Adding a token size is scored (WC-199), so A's ledger list below leaves
  // that kind out and A's total adds these points back.
  const TOKEN_SIZE_KIND = 'added_a_token_size';
  let tokenSizePointsA = 0;
  // Changing a token size is scored (WC-200), so A's ledger list below leaves
  // that kind out and A's total adds these points back.
  const TOKEN_CHANGE_KIND = 'changed_a_token_size';
  let tokenChangePointsA = 0;
  // Deleting a token size is scored (WC-201), so A's ledger list below leaves
  // that kind out and A's total adds these points back.
  const TOKEN_DELETE_KIND = 'deleted_a_token_size';
  let tokenDeletePointsA = 0;
  try {
    const actorA = { role: 'admin' };
    const actorB = { role: 'viewer' };
    const level = 900_000 + Math.floor(Math.random() * 90_000);
    const addedA = await addTokenSize(tokenStore(a), actorA, { name: 'RLS check', diameter: 30, color: '#123456', minPoints: level }, TOOL);
    const stampA = await admin(`/rest/v1/token_sizes?id=eq.${addedA.id}&select=updated_by,tool`);
    check('an admin adds a token size through core, and the database stamps who and the tool',
      addedA.minPoints === level && stampA.json?.[0]?.updated_by === a.id && stampA.json?.[0]?.tool === TOOL, `${JSON.stringify(addedA)} ${JSON.stringify(stampA.json)}`);
    const changedA = await changeTokenSize(tokenStore(a), actorA, addedA.id, { name: 'RLS check', diameter: 31, color: '#654321', minPoints: level }, TOOL);
    check('an admin changes a token size through core', changedA.diameter === 31 && changedA.color === '#654321', JSON.stringify(changedA));
    const readB = await call(`/rest/v1/token_sizes?id=eq.${addedA.id}&select=color`, { token: b.token });
    check('a viewer reads the token sizes', readB.status === 200 && readB.json?.[0]?.color === '#654321', `HTTP ${readB.status} ${JSON.stringify(readB.json)}`);
    const viaCore = await Promise.all([
      addTokenSize(tokenStore(b), actorB, { name: 'Hijacked', diameter: 10, color: '#000000', minPoints: level + 1 }, TOOL).then(() => '', (e) => e.message),
      changeTokenSize(tokenStore(b), actorB, addedA.id, { name: 'Hijacked', diameter: 10, color: '#000000', minPoints: level }, TOOL).then(() => '', (e) => e.message),
      removeTokenSize(tokenStore(b), actorB, addedA.id, TOOL).then(() => '', (e) => e.message),
    ]);
    check('a viewer cannot add, change or remove a token size through core', viaCore.every((m) => /Only an admin can change the token sizes/.test(m)), JSON.stringify(viaCore));
    // B plays a hostile client that claims to be an admin to core: the database still refuses.
    const forgedCore = await addTokenSize(tokenStore(b), actorA, { name: 'Hijacked', diameter: 10, color: '#000000', minPoints: level + 2 }, TOOL).then(() => '', (e) => e.message);
    const insertB = await call('/rest/v1/token_sizes', { method: 'POST', token: b.token, body: { name: 'Hijacked', diameter: 10, color: '#000000', min_points: level + 3, tool: TOOL } });
    const patchB = await call(`/rest/v1/token_sizes?id=eq.${addedA.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { name: 'Hijacked' } });
    const deleteB = await call(`/rest/v1/token_sizes?id=eq.${addedA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
    const afterB = await admin(`/rest/v1/token_sizes?select=id,name`);
    const tokensNow = afterB.json ?? [];
    check('a viewer cannot add, change or remove a token size straight at the table',
      /refused|failed/.test(forgedCore) && insertB.status >= 400 && (patchB.status >= 400 || patchB.json?.length === 0) && (deleteB.status >= 400 || deleteB.json?.length === 0)
        && !tokensNow.some((r) => r.name === 'Hijacked') && tokensNow.some((r) => r.id === addedA.id),
      `core ${forgedCore}, insert HTTP ${insertB.status}, patch HTTP ${patchB.status} ${JSON.stringify(patchB.json)}, delete HTTP ${deleteB.status} ${JSON.stringify(deleteB.json)}`);
    const forgedBy = await call(`/rest/v1/token_sizes?id=eq.${addedA.id}`, { method: 'PATCH', token: a.token, body: { updated_by: b.id } });
    check('nobody can record someone else as the one who changed a token size', forgedBy.status >= 400, `HTTP ${forgedBy.status} ${forgedBy.json?.message ?? ''}`);
    const shared = await call('/rest/v1/token_sizes', { method: 'POST', token: a.token, body: { name: 'Twin', diameter: 10, color: '#000000', min_points: level, tool: TOOL } });
    const badColour = await call('/rest/v1/token_sizes', { method: 'POST', token: a.token, body: { name: 'Bad', diameter: 10, color: 'red', min_points: level + 4, tool: TOOL } });
    const tooBig = await call('/rest/v1/token_sizes', { method: 'POST', token: a.token, body: { name: 'Bad', diameter: 500, color: '#000000', min_points: level + 5, tool: TOOL } });
    check('the database refuses a shared point level, a colour that is not hex, and a size out of range', shared.status >= 400 && badColour.status >= 400 && tooBig.status >= 400,
      `shared HTTP ${shared.status}, colour HTTP ${badColour.status}, size HTTP ${tooBig.status}`);
    await removeTokenSize(tokenStore(a), actorA, addedA.id, TOOL);
    const gone = await admin(`/rest/v1/token_sizes?id=eq.${addedA.id}&select=id`);
    check('an admin removes a token size through core', gone.json?.length === 0, JSON.stringify(gone.json));
    // Adding a token size earns its point
    // (20261123230000_score_added_a_token_size.sql, WC-199): each size saved
    // is scored once for the signed-in member who added it, naming its tool;
    // a refused add, a change, a removal and a service-key write score
    // nothing; nobody can write the engagement themselves.
    {
      const sizeScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TOKEN_SIZE_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const sizeRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${TOKEN_SIZE_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
      const [sa, sb] = [await sizeScores(a), await sizeScores(b)];
      check('adding a token size above recorded exactly one engagement for the admin who added it, worth what the rule says, naming the tool; the change, the removal and the refused adds recorded none',
        sa.length === 1 && sa[0].points === sizeRule?.points && sa[0].tool === TOOL && sa[0].task_id === null && sb.length === 0,
        `A ${JSON.stringify(sa)}, B ${JSON.stringify(sb)}, rule ${sizeRule?.points}`);
      await addTokenSize(tokenStore(a), actorA, { name: 'RLS check 2', diameter: 12, color: '#abcdef', minPoints: level + 6 }, 'rls-check-size-tool');
      const sa2 = await sizeScores(a);
      check('each token size added records one more engagement for the admin, naming the tool it sent',
        sa2.length === 2 && sa2[1].tool === 'rls-check-size-tool', `A ${JSON.stringify(sa2)}`);
      const svc = await admin('/rest/v1/token_sizes', { method: 'POST', prefer: 'return=representation', body: { name: 'RLS service', diameter: 12, color: '#fedcba', min_points: level + 7, tool: 'rls-check-service-size' } });
      const svcScored = (await admin('/rest/v1/engagements?tool=eq.rls-check-service-size&select=id')).json ?? [];
      check('a token size added with the service key (no signed-in member) is saved and scores nobody',
        svc.status < 300 && svc.json?.[0]?.name === 'RLS service' && svcScored.length === 0 && (await sizeScores(a)).length === 2,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, scored ${JSON.stringify(svcScored)}`);
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: TOKEN_SIZE_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: TOKEN_SIZE_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/token_sizes_score', { method: 'POST', token: b.token, body: {} });
      const sb2 = await sizeScores(b);
      check('a member cannot forge an "Added a token size" engagement: not in the ledger, not through the ledger’s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && sb2.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, trigger HTTP ${forgeTrigger.status}, B now ${sb2.length}`);
      check('"Added a token size" is active at 1 point with its four factors and a reason for each',
        sizeRule?.name === 'Added a token size' && sizeRule.points === 1 && sizeRule.effort === 1 && sizeRule.value === 2 && sizeRule.rarity === 2 && sizeRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof sizeRule[k] === 'string' && sizeRule[k].length > 0),
        JSON.stringify(sizeRule));
      tokenSizePointsA = (await sizeScores(a)).reduce((sum, e) => sum + e.points, 0);
    }
    // Deleting a token size earns its point
    // (20261124020000_score_deleted_a_token_size.sql, WC-201): each delete is
    // scored once for the signed-in member who made it, naming the delete's
    // own tool; a refused delete, an add, a change and a service-key delete
    // score nothing; nobody can write the engagement themselves.
    {
      const sizeScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TOKEN_SIZE_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const deleteScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TOKEN_DELETE_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const deleteRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${TOKEN_DELETE_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
      const [da, db] = [await deleteScores(a), await deleteScores(b)];
      check('deleting a token size above recorded exactly one engagement for the admin who deleted it, worth what the rule says, naming the tool; the add, the change and the refused deletes recorded none',
        da.length === 1 && da[0].points === deleteRule?.points && da[0].tool === TOOL && da[0].task_id === null && db.length === 0,
        `A ${JSON.stringify(da)}, B ${JSON.stringify(db)}, rule ${deleteRule?.points}`);
      const spare = await addTokenSize(tokenStore(a), actorA, { name: 'RLS delete', diameter: 12, color: '#abcdef', minPoints: level + 10 }, TOOL);
      await removeTokenSize(tokenStore(a), actorA, spare.id, 'rls-check-delete-tool');
      const da2 = await deleteScores(a);
      const spareGone = await admin(`/rest/v1/token_sizes?id=eq.${spare.id}&select=id`);
      check('each token size deleted records one more engagement for the admin, naming the tool the delete sent',
        da2.length === 2 && da2[1].tool === 'rls-check-delete-tool' && spareGone.json?.length === 0, `A ${JSON.stringify(da2)}, row ${JSON.stringify(spareGone.json)}`);
      const svcSize = await admin('/rest/v1/token_sizes', { method: 'POST', prefer: 'return=representation', body: { name: 'RLS service delete', diameter: 12, color: '#abcdef', min_points: level + 11, tool: TOOL } });
      const svc = await admin(`/rest/v1/token_sizes?id=eq.${svcSize.json?.[0]?.id}`, { method: 'DELETE', prefer: 'return=representation', tool: 'rls-check-service-delete' });
      const svcScored = (await admin('/rest/v1/engagements?tool=eq.rls-check-service-delete&select=id')).json ?? [];
      check('a token size deleted with the service key (no signed-in member) is deleted and scores nobody',
        svcSize.status < 300 && svc.status < 300 && svc.json?.length === 1 && svcScored.length === 0 && (await deleteScores(a)).length === 2,
        `add HTTP ${svcSize.status}, delete HTTP ${svc.status} ${JSON.stringify(svc.json)}, scored ${JSON.stringify(svcScored)}`);
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: TOKEN_DELETE_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: TOKEN_DELETE_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/token_sizes_score_delete', { method: 'POST', token: b.token, body: {} });
      const db2 = await deleteScores(b);
      check('a member cannot forge a "Deleted a token size" engagement: not in the ledger, not through the ledger’s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && db2.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, trigger HTTP ${forgeTrigger.status}, B now ${db2.length}`);
      check('"Deleted a token size" is active at 1 point with its four factors and a reason for each',
        deleteRule?.name === 'Deleted a token size' && deleteRule.points === 1 && deleteRule.effort === 0 && deleteRule.value === 1 && deleteRule.rarity === 1 && deleteRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof deleteRule[k] === 'string' && deleteRule[k].length > 0),
        JSON.stringify(deleteRule));
      tokenDeletePointsA = (await deleteScores(a)).reduce((sum, e) => sum + e.points, 0);
      // The spare size added above scored an "Added a token size" for A too.
      tokenSizePointsA = (await sizeScores(a)).reduce((sum, e) => sum + e.points, 0);
    }
    // Changing a token size earns its point
    // (20261124010000_score_changed_a_token_size.sql, WC-200): each saved
    // change is scored once for the signed-in member who made it, naming its
    // tool; a save that changes nothing, a refused change, an add, a removal
    // and a service-key write score nothing; nobody can write the engagement
    // themselves.
    {
      const changeScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TOKEN_CHANGE_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const changeRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${TOKEN_CHANGE_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
      const [ca, cb] = [await changeScores(a), await changeScores(b)];
      check('changing a token size above recorded exactly one engagement for the admin who changed it, worth what the rule says, naming the tool; the add, the removal and the refused changes recorded none',
        ca.length === 1 && ca[0].points === changeRule?.points && ca[0].tool === TOOL && ca[0].task_id === null && cb.length === 0,
        `A ${JSON.stringify(ca)}, B ${JSON.stringify(cb)}, rule ${changeRule?.points}`);
      const tuned = await addTokenSize(tokenStore(a), actorA, { name: 'RLS change', diameter: 12, color: '#abcdef', minPoints: level + 8 }, TOOL);
      await changeTokenSize(tokenStore(a), actorA, tuned.id, { name: 'RLS change', diameter: 12, color: '#abcdef', minPoints: level + 8 }, 'rls-check-noop-size');
      const ca2 = await changeScores(a);
      check('a token size saved with nothing changed records no engagement', ca2.length === 1, `A ${JSON.stringify(ca2)}`);
      await changeTokenSize(tokenStore(a), actorA, tuned.id, { name: 'RLS change', diameter: 13, color: '#abcdef', minPoints: level + 8 }, 'rls-check-change-tool');
      const ca3 = await changeScores(a);
      check('each saved change to a token size records one more engagement for the admin, naming the tool it sent',
        ca3.length === 2 && ca3[1].tool === 'rls-check-change-tool', `A ${JSON.stringify(ca3)}`);
      const svc = await admin(`/rest/v1/token_sizes?id=eq.${tuned.id}`, { method: 'PATCH', prefer: 'return=representation', body: { diameter: 14, tool: 'rls-check-service-change' } });
      const svcScored = (await admin('/rest/v1/engagements?tool=eq.rls-check-service-change&select=id')).json ?? [];
      check('a token size changed with the service key (no signed-in member) is saved and scores nobody',
        svc.status < 300 && svc.json?.[0]?.diameter === 14 && svcScored.length === 0 && (await changeScores(a)).length === 2,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, scored ${JSON.stringify(svcScored)}`);
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: TOKEN_CHANGE_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: TOKEN_CHANGE_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/token_sizes_score_changed', { method: 'POST', token: b.token, body: {} });
      const cb2 = await changeScores(b);
      check('a member cannot forge a "Changed a token size" engagement: not in the ledger, not through the ledger’s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && cb2.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, trigger HTTP ${forgeTrigger.status}, B now ${cb2.length}`);
      check('"Changed a token size" is active at 1 point with its four factors and a reason for each',
        changeRule?.name === 'Changed a token size' && changeRule.points === 1 && changeRule.effort === 1 && changeRule.value === 2 && changeRule.rarity === 1 && changeRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof changeRule[k] === 'string' && changeRule[k].length > 0),
        JSON.stringify(changeRule));
      await removeTokenSize(tokenStore(a), actorA, tuned.id, TOOL);
      tokenChangePointsA = (await changeScores(a)).reduce((sum, e) => sum + e.points, 0);
      // The size added above for this block scored "Added a token size" too, so recount it.
      tokenSizePointsA = ((await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.${TOKEN_SIZE_KIND}&select=points`)).json ?? []).reduce((sum, e) => sum + e.points, 0);
      // The size removed above for this block scored "Deleted a token size" too, so recount it.
      tokenDeletePointsA = ((await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.${TOKEN_DELETE_KIND}&select=points`)).json ?? []).reduce((sum, e) => sum + e.points, 0);
    }
    const anonTokens = await call('/rest/v1/token_sizes?select=id');
    check('a signed-out visitor sees no token sizes', anonTokens.status >= 400 || anonTokens.json?.length === 0, `HTTP ${anonTokens.status} ${JSON.stringify(anonTokens.json)}`);
  } finally {
    await admin('/rest/v1/token_sizes?id=not.is.null', { method: 'DELETE' });
    if (tokensBefore.length) await admin('/rest/v1/token_sizes', { method: 'POST', body: tokensBefore });
    const restored = (await admin(`/rest/v1/token_sizes?select=${TOKEN_COLUMNS}&order=min_points`)).json;
    check('the token sizes are put back as they were', JSON.stringify(restored) === JSON.stringify(tokensBefore), `before ${JSON.stringify(tokensBefore)}, after ${JSON.stringify(restored)}`);
  }

  // Proposals (20261102210000_proposals.sql): every member reads every
  // proposal; a member adds, changes and deletes only their own, through core
  // or straight at the table. The test members' proposals go with their
  // accounts at the end (owner_id cascades).
  {
    const propA = await createProposal(proposalStore(a), { title: 'A’s proposal', notes: 'why', points: 3, priority: 'high' }, TOOL);
    check('a member adds a proposal through core, owned by them and naming the tool', propA.ownerId === a.id && propA.tool === TOOL && propA.points === 3 && propA.priority === 'high', JSON.stringify(propA));
    const propB = await createProposal(proposalStore(b), { title: 'B’s proposal' }, TOOL);
    const both = await call(`/rest/v1/proposals?id=in.(${propA.id},${propB.id})&select=id`, { token: b.token });
    check('every member reads every proposal', both.status === 200 && both.json?.length === 2, `HTTP ${both.status} ${JSON.stringify(both.json)}`);
    const viaCore = await updateProposal(proposalStore(b), propA.id, { title: 'Hijacked' }, TOOL).then(() => '', (e) => e.message);
    const delCore = await deleteProposal(proposalStore(b), propA.id, TOOL).then(() => '', (e) => e.message);
    check('a member cannot change or delete another member’s proposal through core', /may change/.test(viaCore) && /may delete/.test(delCore), `${viaCore} / ${delCore}`);
    const patch = await call(`/rest/v1/proposals?id=eq.${propA.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { title: 'Hijacked', owner_id: b.id } });
    const del = await call(`/rest/v1/proposals?id=eq.${propA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
    const forge = await call('/rest/v1/proposals', { method: 'POST', token: b.token, body: { title: 'forged', owner_id: a.id } });
    const stillA = (await admin(`/rest/v1/proposals?id=eq.${propA.id}&select=title,owner_id`)).json?.[0];
    check('a member cannot change, delete or forge another member’s proposal straight at the table',
      patch.json?.length === 0 && del.json?.length === 0 && forge.status >= 400 && stillA?.title === 'A’s proposal' && stillA?.owner_id === a.id,
      `patch ${JSON.stringify(patch.json)}, delete ${JSON.stringify(del.json)}, forge HTTP ${forge.status}, row ${JSON.stringify(stillA)}`);
    const takeOver = await call(`/rest/v1/proposals?id=eq.${propB.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { owner_id: a.id } });
    check('a member cannot hand their proposal to someone else', takeOver.status >= 400, `HTTP ${takeOver.status} ${JSON.stringify(takeOver.json)}`);
    const changed = await updateProposal(proposalStore(a), propA.id, { title: 'A’s proposal, changed', status: 'doing', points: 5 }, TOOL);
    check('the owner changes their own proposal through core', changed.title === 'A’s proposal, changed' && changed.status === 'doing' && changed.points === 5, JSON.stringify(changed));
    const bad = await call('/rest/v1/proposals', { method: 'POST', token: a.token, body: [{ title: ' \n ' }] });
    const negative = await call(`/rest/v1/proposals?id=eq.${propA.id}`, { method: 'PATCH', token: a.token, body: { points: -1 } });
    const proposed = await call(`/rest/v1/proposals?id=eq.${propA.id}`, { method: 'PATCH', token: a.token, body: { status: 'proposed' } });
    check('the database refuses a blank title, negative points and a status a proposal does not have', bad.status >= 400 && negative.status >= 400 && proposed.status >= 400,
      `blank HTTP ${bad.status}, negative HTTP ${negative.status}, proposed HTTP ${proposed.status}`);
    await deleteProposal(proposalStore(a), propA.id, TOOL);
    const gone = (await admin(`/rest/v1/proposals?id=eq.${propA.id}&select=id`)).json;
    check('the owner deletes their own proposal through core', Array.isArray(gone) && gone.length === 0, JSON.stringify(gone));
    const anonProposals = await call('/rest/v1/proposals?select=id');
    check('a signed-out visitor sees no proposals', anonProposals.status >= 400 || anonProposals.json?.length === 0, `HTTP ${anonProposals.status} ${JSON.stringify(anonProposals.json)}`);
  }

  // Forum topics and tags (20261115210000_forum_topics_tags.sql): every
  // member reads and adds them, in their own name; only the adder or an
  // admin changes or deletes one (the next two blocks); a name
  // is unique ignoring capitals and spaces. The test rows are
  // removed at the end (created_by is set null, not cascaded, when an
  // account goes).
  {
    const forumIds = { forum_topics: [], forum_tags: [] };
    try {
      for (const table of ['forum_topics', 'forum_tags']) {
        const word = `RLS check ${table} ${randomUUID().slice(0, 8)}`;
        const added = await call(`/rest/v1/${table}`, { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: word } });
        const row = added.json?.[0];
        if (row?.id) forumIds[table].push(row.id);
        check(`a member adds to ${table} in their own name`, added.status === 201 && row?.created_by === a.id && row?.tool === 'wavecenter', `HTTP ${added.status} ${JSON.stringify(added.json)}`);
        const seen = await call(`/rest/v1/${table}?id=eq.${row?.id}&select=id`, { token: b.token });
        check(`every member reads ${table}`, seen.status === 200 && seen.json?.length === 1, `HTTP ${seen.status} ${JSON.stringify(seen.json)}`);
        const twin = await call(`/rest/v1/${table}`, { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: `  ${word.toUpperCase()} ` } });
        if (twin.json?.[0]?.id) forumIds[table].push(twin.json[0].id);
        check(`${table} refuses a name already there, whatever its capitals`, twin.status === 409, `HTTP ${twin.status} ${JSON.stringify(twin.json)}`);
        const forge = await call(`/rest/v1/${table}`, { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: `${word} forged`, created_by: a.id } });
        if (forge.json?.[0]?.id) forumIds[table].push(forge.json[0].id);
        const blank = await call(`/rest/v1/${table}`, { method: 'POST', token: a.token, body: { name: ' \n ' } });
        const long = await call(`/rest/v1/${table}`, { method: 'POST', token: a.token, body: { name: 'x'.repeat(81) } });
        check(`${table} refuses a forged adder, a blank name and one over 80 characters`, forge.status >= 400 && blank.status >= 400 && long.status >= 400,
          `forge HTTP ${forge.status}, blank HTTP ${blank.status}, long HTTP ${long.status}`);
        // Topics (WC-183) and tags (WC-186): their adder or an admin may
        // change or delete one, so B, neither, is refused.
        const patch = await call(`/rest/v1/${table}?id=eq.${row?.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { name: 'changed' } });
        const del = await call(`/rest/v1/${table}?id=eq.${row?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
        const still = (await admin(`/rest/v1/${table}?id=eq.${row?.id}&select=name`)).json?.[0];
        const refused = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
        check(`a member who neither added it nor is an admin cannot change or delete a row of ${table}`,
          refused(patch) && refused(del) && still?.name === word, `patch HTTP ${patch.status}, delete HTTP ${del.status}, row ${JSON.stringify(still)}`);
        const anon = await call(`/rest/v1/${table}?select=id`);
        check(`a signed-out visitor sees nothing in ${table}`, anon.status >= 400 || anon.json?.length === 0, `HTTP ${anon.status} ${JSON.stringify(anon.json)}`);
      }
    } finally {
      for (const [table, ids] of Object.entries(forumIds)) {
        if (ids.length) await admin(`/rest/v1/${table}?id=in.(${ids.join(',')})`, { method: 'DELETE' });
      }
    }
  }

  // A Forum topic's details, changing and deleting it
  // (20261122210000_forum_topic_details.sql, WC-183): a new topic gets a slug
  // from its name; only its adder (B here, a viewer) or an admin (A) changes
  // its name, slug, description, details and parent, or deletes it; nothing
  // else about it can be changed; a bad slug, a duplicate slug and a loop of
  // parents are refused; deleting a parent leaves its sub-topics with none.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const add = async (who, name) => {
      const r = await call('/rest/v1/forum_topics', { method: 'POST', token: who.token, prefer: 'return=representation', body: { name } });
      if (r.json?.[0]?.id) ids.push(r.json[0].id);
      return r;
    };
    const patch = (who, id, body) => call(`/rest/v1/forum_topics?id=eq.${id}`, { method: 'PATCH', token: who?.token, prefer: 'return=representation', body });
    const row = async (id) => (await admin(`/rest/v1/forum_topics?id=eq.${id}&select=*`)).json?.[0];
    try {
      const madeB = await add(b, `RLS Topic B ${tag}!`);
      const topicB = madeB.json?.[0];
      check('a new topic gets a slug made from its name, and blank description and details', madeB.status === 201 && topicB?.slug === `rls-topic-b-${tag}` && topicB?.description === '' && topicB?.details === '' && topicB?.parent_id === null,
        `HTTP ${madeB.status} ${JSON.stringify(madeB.json)}`);
      const twin = await add(b, `rls topic b ${tag}?`);
      check('a second topic whose name makes the same slug gets the next free one', twin.json?.[0]?.slug === `rls-topic-b-${tag}-2`, JSON.stringify(twin.json));
      const topicA = (await add(a, `RLS Topic A ${tag}`)).json?.[0];

      const own = await patch(b, topicB?.id, { name: `RLS Topic B ${tag} changed`, slug: `rls-b-${tag}`, description: 'One line', details: '**Bold** and\n- a list' });
      check('the adder changes their topic’s name, slug, description and details', own.status === 200 && own.json?.[0]?.slug === `rls-b-${tag}` && own.json?.[0]?.details === '**Bold** and\n- a list',
        `HTTP ${own.status} ${JSON.stringify(own.json)}`);
      const stamped = await row(topicB?.id);
      check('the database stamps when a topic last changed, never its adder or when it was added', stamped?.updated_at > stamped?.created_at && stamped?.created_by === b.id && stamped?.created_at === topicB?.created_at, JSON.stringify(stamped));

      const notYours = await patch(b, topicA?.id, { description: 'B was here' });
      const notYoursDel = await call(`/rest/v1/forum_topics?id=eq.${topicA?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
      const keptA = await row(topicA?.id);
      check('a non-admin cannot change or delete a topic someone else added', (notYours.json?.length ?? 0) === 0 && (notYoursDel.json?.length ?? 0) === 0 && keptA?.description === '',
        `patch HTTP ${notYours.status} ${JSON.stringify(notYours.json)}, delete HTTP ${notYoursDel.status}, row ${JSON.stringify(keptA)}`);
      const byAdmin = await patch(a, topicB?.id, { description: 'An admin changed this' });
      check('an admin changes a topic someone else added', byAdmin.status === 200 && byAdmin.json?.[0]?.description === 'An admin changed this', `HTTP ${byAdmin.status} ${JSON.stringify(byAdmin.json)}`);

      const forged = await patch(b, topicB?.id, { created_by: a.id });
      const forgedTool = await patch(b, topicB?.id, { tool: 'forged' });
      const forgedTime = await patch(b, topicB?.id, { created_at: '2020-01-01T00:00:00Z' });
      check('nobody changes who added a topic, its tool or when it was added', forged.status >= 400 && forgedTool.status >= 400 && forgedTime.status >= 400,
        `created_by HTTP ${forged.status}, tool HTTP ${forgedTool.status}, created_at HTTP ${forgedTime.status}`);
      const badSlug = await patch(b, topicB?.id, { slug: 'Not A Slug' });
      const dupSlug = await patch(b, topicB?.id, { slug: twin.json?.[0]?.slug });
      const longDesc = await patch(b, topicB?.id, { description: 'x'.repeat(501) });
      const twoLines = await patch(b, topicB?.id, { description: 'one\ntwo' });
      const longDetails = await patch(b, topicB?.id, { details: 'x'.repeat(10001) });
      check('the database refuses a badly formed or taken slug, a description over 500 characters or on two lines, and details over 10,000',
        badSlug.status >= 400 && dupSlug.status === 409 && longDesc.status >= 400 && twoLines.status >= 400 && longDetails.status >= 400,
        `bad slug ${badSlug.status}, taken slug ${dupSlug.status}, long ${longDesc.status}, two lines ${twoLines.status}, long details ${longDetails.status}`);

      // A over B, then B over A would be a loop; and nothing is its own parent.
      const under = await patch(a, topicA?.id, { parent_id: topicB?.id });
      check('an admin puts a topic under another', under.status === 200 && under.json?.[0]?.parent_id === topicB?.id, `HTTP ${under.status} ${JSON.stringify(under.json)}`);
      const loop = await patch(b, topicB?.id, { parent_id: topicA?.id });
      const self = await patch(b, topicB?.id, { parent_id: topicB?.id });
      const selfId = randomUUID();
      const selfInsert = await call('/rest/v1/forum_topics', { method: 'POST', token: b.token, body: { id: selfId, name: `RLS self ${tag}`, parent_id: selfId } });
      if (selfInsert.status < 300) ids.push(selfId);
      check('the database refuses a topic under its own sub-topic, or under itself, whether changed or added', loop.status >= 400 && self.status >= 400 && selfInsert.status >= 400 && (await row(topicB?.id))?.parent_id === null,
        `loop HTTP ${loop.status} ${JSON.stringify(loop.json)}, self HTTP ${self.status}, added as its own parent HTTP ${selfInsert.status}`);

      const anonPatch = await patch(null, topicB?.id, { description: 'anon' });
      const anonDel = await call(`/rest/v1/forum_topics?id=eq.${topicB?.id}`, { method: 'DELETE', prefer: 'return=representation' });
      check('a signed-out visitor changes and deletes no topic', (anonPatch.status >= 400 || (anonPatch.json?.length ?? 0) === 0) && (anonDel.status >= 400 || (anonDel.json?.length ?? 0) === 0) && (await row(topicB?.id))?.description === 'An admin changed this',
        `patch HTTP ${anonPatch.status}, delete HTTP ${anonDel.status}`);

      const gone = await call(`/rest/v1/forum_topics?id=eq.${topicB?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
      const orphan = await row(topicA?.id);
      check('the adder deletes their topic, and its sub-topic stays with no parent', gone.status === 200 && gone.json?.length === 1 && !(await row(topicB?.id)) && orphan && orphan.parent_id === null,
        `HTTP ${gone.status} ${JSON.stringify(gone.json)}, sub-topic ${JSON.stringify(orphan)}`);
      const adminDel = await call(`/rest/v1/forum_topics?id=eq.${twin.json?.[0]?.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
      check('an admin deletes a topic someone else added', adminDel.status === 200 && adminDel.json?.length === 1, `HTTP ${adminDel.status} ${JSON.stringify(adminDel.json)}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/forum_topics?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Adding a forum topic earns its point
  // (20261123140000_score_added_a_forum_topic.sql, WC-190): a new topic is
  // scored once for the member who added it, naming the row's tool; a tag, a
  // refused topic and a service-key insert score nothing; nobody can write
  // the engagement themselves. The two blocks above added two topics each
  // for A and B, so each already has two.
  let forumTopicPointsA = 0;
  {
    const TOPIC_KIND = 'added_a_forum_topic';
    const topicRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TOPIC_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const topicRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${TOPIC_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const ids = [];
    const tagIds = [];
    try {
      const [ta, tb] = [await topicRows(a), await topicRows(b)];
      check('each forum topic a member added above recorded one engagement for them, worth what the rule says, naming its tool',
        ta.length === 2 && tb.length === 2 && [...ta, ...tb].every((e) => e.points === topicRule?.points && e.tool === 'wavecenter' && e.task_id === null),
        `A ${JSON.stringify(ta)}, B ${JSON.stringify(tb)}, rule ${topicRule?.points}`);
      const word = `RLS scored topic ${randomUUID().slice(0, 8)}`;
      const added = await call('/rest/v1/forum_topics', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: word, tool: 'rls-check-forum-tool' } });
      if (added.json?.[0]?.id) ids.push(added.json[0].id);
      const twin = await call('/rest/v1/forum_topics', { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: word.toUpperCase() } });
      if (twin.json?.[0]?.id) ids.push(twin.json[0].id);
      const tag = await call('/rest/v1/forum_tags', { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: word } });
      if (tag.json?.[0]?.id) tagIds.push(tag.json[0].id);
      const [ta2, tb2] = [await topicRows(a), await topicRows(b)];
      check('adding a forum topic records exactly one engagement for the member who added it, naming the tool it sent; a refused topic or a tag records none',
        added.status === 201 && twin.status === 409 && tag.status === 201 && ta2.length === 3 && ta2[2].tool === 'rls-check-forum-tool' && ta2[2].points === topicRule?.points && tb2.length === tb.length,
        `added HTTP ${added.status}, twin HTTP ${twin.status}, tag HTTP ${tag.status}, A ${JSON.stringify(ta2)}, B had ${tb.length} now ${tb2.length}`);
      check('"Added a forum topic" is active at 1 point with its four factors and a reason for each',
        topicRule?.name === 'Added a forum topic' && topicRule.points === 1 && topicRule.effort === 1 && topicRule.value === 2 && topicRule.rarity === 1 && topicRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof topicRule[k] === 'string' && topicRule[k].length > 0),
        JSON.stringify(topicRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: TOPIC_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: TOPIC_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/forum_topics_score', { method: 'POST', token: b.token, body: {} });
      const tb3 = await topicRows(b);
      check('a member cannot forge an "Added a forum topic" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && tb3.length === tb.length,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, forum_topics_score HTTP ${forgeTrigger.status}, B now ${tb3.length}`);
      const svc = await admin('/rest/v1/forum_topics', { method: 'POST', prefer: 'return=representation', body: { name: `${word} by service key`, created_by: a.id } });
      if (svc.json?.[0]?.id) ids.push(svc.json[0].id);
      const ta4 = await topicRows(a);
      check('a forum topic added with the service key (no signed-in member) is saved and scores nothing',
        svc.status === 201 && Array.isArray(svc.json) && svc.json.length === 1 && ta4.length === ta2.length,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${ta2.length} now ${ta4.length}`);
      forumTopicPointsA = ta4.reduce((sum, e) => sum + e.points, 0);
    } finally {
      if (ids.length) await admin(`/rest/v1/forum_topics?id=in.(${ids.join(',')})`, { method: 'DELETE' });
      if (tagIds.length) await admin(`/rest/v1/forum_tags?id=in.(${tagIds.join(',')})`, { method: 'DELETE' });
    }
  }

  // A Forum tag's details, related tags, changing and deleting it
  // (20261123010000_forum_tag_relations.sql, WC-186): a new tag gets a slug
  // from its name; only its adder (B here, a viewer) or an admin (A) changes
  // or deletes it, or sets its related tags; a relation is stored once and
  // read both ways, never a tag with itself; forum_tag_save is all or
  // nothing; deleting a tag deletes its relations.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const add = async (who, name) => {
      const r = await call('/rest/v1/forum_tags', { method: 'POST', token: who.token, prefer: 'return=representation', body: { name } });
      if (r.json?.[0]?.id) ids.push(r.json[0].id);
      return r.json?.[0];
    };
    const save = (who, t, related, more = {}) => call('/rest/v1/rpc/forum_tag_save', {
      method: 'POST', token: who?.token,
      body: { p_id: t?.id, p_name: t?.name, p_slug: t?.slug, p_description: '', p_details: '', p_related: related, ...more },
    });
    const pairs = async () => (await admin(`/rest/v1/forum_tag_relations?or=(tag_id.in.(${ids.join(',')}),related_tag_id.in.(${ids.join(',')}))&select=tag_id,related_tag_id,created_by`)).json ?? [];
    const row = async (id) => (await admin(`/rest/v1/forum_tags?id=eq.${id}&select=*`)).json?.[0];
    try {
      const voting = await add(b, `RLS Voting ${tag}!`);
      const budget = await add(b, `RLS Budget ${tag}`);
      const roads = await add(a, `RLS Roads ${tag}`);
      check('a new tag gets a slug made from its name, and blank description and details', voting?.slug === `rls-voting-${tag}` && voting?.description === '' && voting?.details === '' && !!voting?.updated_at,
        JSON.stringify(voting));

      const own = await save(b, voting, [budget?.id, roads?.id], { p_description: 'How we vote', p_details: '**Bold**' });
      const afterOwn = await pairs();
      const lo = (x, y) => (x < y ? [x, y] : [y, x]);
      const has = (x, y) => afterOwn.some((p) => p.tag_id === lo(x, y)[0] && p.related_tag_id === lo(x, y)[1]);
      check('the adder saves their tag’s words and related tags, each relation stored once, smaller id first, in their name',
        own.status < 300 && (await row(voting?.id))?.description === 'How we vote' && afterOwn.length === 2 && has(voting?.id, budget?.id) && has(voting?.id, roads?.id) && afterOwn.every((p) => p.created_by === b.id),
        `HTTP ${own.status} ${JSON.stringify(own.json)}, relations ${JSON.stringify(afterOwn)}`);
      const seen = await call(`/rest/v1/forum_tag_relations?or=(tag_id.eq.${roads?.id},related_tag_id.eq.${roads?.id})&select=tag_id`, { token: a.token });
      check('every member reads the related tags, from either side', seen.status === 200 && seen.json?.length === 1, `HTTP ${seen.status} ${JSON.stringify(seen.json)}`);

      const notYours = await save(b, roads, [voting?.id], { p_description: 'B was here' });
      check('a non-admin cannot save a tag someone else added, and nothing of it is saved', notYours.status >= 400 && (await row(roads?.id))?.description === '',
        `HTTP ${notYours.status} ${JSON.stringify(notYours.json)}`);
      const patchNot = await call(`/rest/v1/forum_tags?id=eq.${roads?.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { description: 'B' } });
      const delNot = await call(`/rest/v1/forum_tags?id=eq.${roads?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
      check('a non-admin cannot change or delete a tag someone else added, going around the save', (patchNot.json?.length ?? 0) === 0 && (delNot.json?.length ?? 0) === 0 && !!(await row(roads?.id)),
        `patch HTTP ${patchNot.status}, delete HTTP ${delNot.status}`);

      // A stranger's relation between two tags B neither added: refused, either way round.
      const stranger = await add(a, `RLS Stranger ${tag}`);
      const [x, y] = lo(roads?.id, stranger?.id);
      const forgeRel = await call('/rest/v1/forum_tag_relations', { method: 'POST', token: b.token, body: { tag_id: x, related_tag_id: y } });
      const forgeBy = await call('/rest/v1/forum_tag_relations', { method: 'POST', token: b.token, body: { tag_id: lo(voting?.id, stranger?.id)[0], related_tag_id: lo(voting?.id, stranger?.id)[1], created_by: a.id } });
      const unrelate = await call(`/rest/v1/forum_tag_relations?tag_id=eq.${lo(voting?.id, budget?.id)[0]}&related_tag_id=eq.${lo(voting?.id, budget?.id)[1]}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
      check('a member relates two tags only if they may change one of them, never in someone else’s name; an admin removes any relation',
        forgeRel.status >= 400 && forgeBy.status >= 400 && unrelate.status === 200 && unrelate.json?.length === 1,
        `stranger HTTP ${forgeRel.status}, forged adder HTTP ${forgeBy.status}, admin unrelate HTTP ${unrelate.status} ${JSON.stringify(unrelate.json)}`);
      // Voting is B's, Roads is A's: B may still remove the relation between them.
      const bDelOther = await call(`/rest/v1/forum_tag_relations?tag_id=eq.${lo(voting?.id, roads?.id)[0]}&related_tag_id=eq.${lo(voting?.id, roads?.id)[1]}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
      check('the adder of one of the two tags removes the relation between them', bDelOther.status === 200 && bDelOther.json?.length === 1, `HTTP ${bDelOther.status} ${JSON.stringify(bDelOther.json)}`);

      const self = await save(b, voting, [voting?.id]);
      const missing = await save(b, voting, [budget?.id, randomUUID()], { p_description: 'should not stick' });
      const twice = await save(b, voting, [budget?.id, budget?.id]);
      const afterTwice = await pairs();
      check('the save refuses a tag related to itself or to a tag that is not there, saving nothing; a repeat counts once',
        self.status >= 400 && missing.status >= 400 && (await row(voting?.id))?.description === '' && twice.status < 300 && afterTwice.length === 1,
        `self HTTP ${self.status} ${JSON.stringify(self.json)}, missing HTTP ${missing.status}, twice HTTP ${twice.status}, relations ${JSON.stringify(afterTwice)}`);
      const rawSelf = await call('/rest/v1/forum_tag_relations', { method: 'POST', token: b.token, body: { tag_id: voting?.id, related_tag_id: voting?.id } });
      const [hi, low] = lo(voting?.id, budget?.id).reverse();
      const rawBackwards = await call('/rest/v1/forum_tag_relations', { method: 'POST', token: b.token, body: { tag_id: hi, related_tag_id: low } });
      check('the table itself refuses a tag related to itself, and the same pair stored the other way round', rawSelf.status >= 400 && rawBackwards.status >= 400,
        `self HTTP ${rawSelf.status}, backwards HTTP ${rawBackwards.status}`);

      const forged = await call(`/rest/v1/forum_tags?id=eq.${voting?.id}`, { method: 'PATCH', token: b.token, body: { created_by: a.id } });
      const forgedTool = await call(`/rest/v1/forum_tags?id=eq.${voting?.id}`, { method: 'PATCH', token: b.token, body: { tool: 'forged' } });
      const badSlug = await save(b, voting, [], { p_slug: 'Not A Slug' });
      const dupSlug = await save(b, voting, [], { p_slug: budget?.slug });
      const twoLines = await save(b, voting, [], { p_description: 'one\ntwo' });
      check('nobody changes who added a tag or its tool; the database refuses a bad or taken slug and a two-line description',
        forged.status >= 400 && forgedTool.status >= 400 && badSlug.status >= 400 && dupSlug.status === 409 && twoLines.status >= 400,
        `created_by ${forged.status}, tool ${forgedTool.status}, bad slug ${badSlug.status}, taken slug ${dupSlug.status}, two lines ${twoLines.status}`);

      const byAdmin = await save(a, voting, [roads?.id], { p_description: 'An admin changed this' });
      check('an admin saves a tag someone else added', byAdmin.status < 300 && (await row(voting?.id))?.description === 'An admin changed this', `HTTP ${byAdmin.status} ${JSON.stringify(byAdmin.json)}`);
      const anonSave = await save(null, voting, []);
      check('a signed-out visitor cannot save a tag', anonSave.status >= 400 && (await pairs()).length === 1, `HTTP ${anonSave.status}`);

      const gone = await call(`/rest/v1/forum_tags?id=eq.${voting?.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
      check('the adder deletes their tag, and its relations go with it', gone.status === 200 && gone.json?.length === 1 && !(await row(voting?.id)) && (await pairs()).length === 0,
        `HTTP ${gone.status} ${JSON.stringify(gone.json)}, relations ${JSON.stringify(await pairs())}`);
      const adminDel = await call(`/rest/v1/forum_tags?id=eq.${budget?.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
      check('an admin deletes a tag someone else added', adminDel.status === 200 && adminDel.json?.length === 1, `HTTP ${adminDel.status} ${JSON.stringify(adminDel.json)}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/forum_tags?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Adding a forum tag earns its point
  // (20261123150000_score_added_a_forum_tag.sql, WC-191): a new tag is
  // scored once for the member who added it, naming the row's tool; a topic,
  // a refused tag and a service-key insert score nothing; nobody can write
  // the engagement themselves. Counts are taken at the start of the block,
  // so tags added by the checks above (A's one, so far) do not matter here.
  let forumTagPointsA = 0;
  {
    const TAG_KIND = 'added_a_forum_tag';
    const tagRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${TAG_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const tagRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${TAG_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const ids = [];
    const topicIds = [];
    try {
      const [ta, tb] = [await tagRows(a), await tagRows(b)];
      check('each forum tag a member added above recorded one engagement for them, worth what the rule says, naming its tool',
        ta.length >= 1 && [...ta, ...tb].every((e) => e.points === tagRule?.points && e.tool === 'wavecenter' && e.task_id === null),
        `A ${JSON.stringify(ta)}, B ${JSON.stringify(tb)}, rule ${tagRule?.points}`);
      const word = `RLS scored tag ${randomUUID().slice(0, 8)}`;
      const added = await call('/rest/v1/forum_tags', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: word, tool: 'rls-check-forum-tool' } });
      if (added.json?.[0]?.id) ids.push(added.json[0].id);
      const twin = await call('/rest/v1/forum_tags', { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: word.toUpperCase() } });
      if (twin.json?.[0]?.id) ids.push(twin.json[0].id);
      const topic = await call('/rest/v1/forum_topics', { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: word } });
      if (topic.json?.[0]?.id) topicIds.push(topic.json[0].id);
      const [ta2, tb2] = [await tagRows(a), await tagRows(b)];
      check('adding a forum tag records exactly one engagement for the member who added it, naming the tool it sent; a refused tag or a topic records none',
        added.status === 201 && twin.status === 409 && topic.status === 201 && ta2.length === ta.length + 1 && ta2.at(-1)?.tool === 'rls-check-forum-tool' && ta2.at(-1)?.points === tagRule?.points && tb2.length === tb.length,
        `added HTTP ${added.status}, twin HTTP ${twin.status}, topic HTTP ${topic.status}, A had ${ta.length} now ${JSON.stringify(ta2)}, B had ${tb.length} now ${tb2.length}`);
      check('"Added a forum tag" is active at 1 point with its four factors and a reason for each',
        tagRule?.name === 'Added a forum tag' && tagRule.points === 1 && tagRule.effort === 1 && tagRule.value === 1 && tagRule.rarity === 1 && tagRule.farm_risk === 2
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof tagRule[k] === 'string' && tagRule[k].length > 0),
        JSON.stringify(tagRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: TAG_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: TAG_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/forum_tags_score', { method: 'POST', token: b.token, body: {} });
      const tb3 = await tagRows(b);
      check('a member cannot forge an "Added a forum tag" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && tb3.length === tb.length,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, forum_tags_score HTTP ${forgeTrigger.status}, B now ${tb3.length}`);
      const svc = await admin('/rest/v1/forum_tags', { method: 'POST', prefer: 'return=representation', body: { name: `${word} by service key`, created_by: a.id } });
      if (svc.json?.[0]?.id) ids.push(svc.json[0].id);
      const ta4 = await tagRows(a);
      check('a forum tag added with the service key (no signed-in member) is saved and scores nothing',
        svc.status === 201 && Array.isArray(svc.json) && svc.json.length === 1 && ta4.length === ta2.length,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${ta2.length} now ${ta4.length}`);
      forumTagPointsA = ta4.reduce((sum, e) => sum + e.points, 0);
    } finally {
      if (ids.length) await admin(`/rest/v1/forum_tags?id=in.(${ids.join(',')})`, { method: 'DELETE' });
      if (topicIds.length) await admin(`/rest/v1/forum_topics?id=in.(${topicIds.join(',')})`, { method: 'DELETE' });
    }
  }

  // Making a proposal earns its point
  // (20261123160000_score_made_a_proposal.sql, WC-192): a new proposal is
  // scored once for the member who made it, naming the row's tool; a refused
  // proposal, a change, a delete and a service-key insert score nothing;
  // nobody can write the engagement themselves. Counts are taken at the start
  // of the block, so proposals made by the checks above (one each for A and
  // B, so far) do not matter here.
  let madeProposalPointsA = 0;
  {
    const PROPOSAL_KIND = 'made_a_proposal';
    const proposalRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${PROPOSAL_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const proposalRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${PROPOSAL_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const ids = [];
    try {
      const [pa, pb] = [await proposalRows(a), await proposalRows(b)];
      check('each proposal a member made above recorded one engagement for them, worth what the rule says, naming its tool',
        pa.length >= 1 && pb.length >= 1 && [...pa, ...pb].every((e) => e.points === proposalRule?.points && e.tool === TOOL && e.task_id === null),
        `A ${JSON.stringify(pa)}, B ${JSON.stringify(pb)}, rule ${proposalRule?.points}`);
      const title = `RLS scored proposal ${randomUUID().slice(0, 8)}`;
      const made = await call('/rest/v1/proposals', { method: 'POST', token: a.token, prefer: 'return=representation', body: { title, tool: 'rls-check-proposal-tool' } });
      if (made.json?.[0]?.id) ids.push(made.json[0].id);
      const blank = await call('/rest/v1/proposals', { method: 'POST', token: b.token, prefer: 'return=representation', body: { title: ' \n ' } });
      const inAsName = await call('/rest/v1/proposals', { method: 'POST', token: b.token, prefer: 'return=representation', body: { title, owner_id: a.id } });
      const changed = made.json?.[0]?.id
        ? await call(`/rest/v1/proposals?id=eq.${made.json[0].id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { title: `${title}, changed` } })
        : { status: 0 };
      const [pa2, pb2] = [await proposalRows(a), await proposalRows(b)];
      check('making a proposal records exactly one engagement for the member who made it, naming the tool it sent; a refused one or a change records none',
        made.status === 201 && blank.status >= 400 && inAsName.status >= 400 && changed.status === 200 && pa2.length === pa.length + 1 && pa2.at(-1)?.tool === 'rls-check-proposal-tool' && pa2.at(-1)?.points === proposalRule?.points && pb2.length === pb.length,
        `made HTTP ${made.status}, blank HTTP ${blank.status}, in A's name HTTP ${inAsName.status}, change HTTP ${changed.status}, A had ${pa.length} now ${JSON.stringify(pa2)}, B had ${pb.length} now ${pb2.length}`);
      check('"Made a proposal" is active at 1 point with its four factors and a reason for each',
        proposalRule?.name === 'Made a proposal' && proposalRule.points === 1 && proposalRule.effort === 1 && proposalRule.value === 2 && proposalRule.rarity === 0 && proposalRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof proposalRule[k] === 'string' && proposalRule[k].length > 0),
        JSON.stringify(proposalRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: PROPOSAL_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: PROPOSAL_KIND, p_tool: TOOL, p_task: null } });
      const pb3 = await proposalRows(b);
      check('a member cannot forge a "Made a proposal" engagement: not in the ledger, not through the ledger\u2019s function',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && pb3.length === pb.length,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, B now ${pb3.length}`);
      const svc = await admin('/rest/v1/proposals', { method: 'POST', prefer: 'return=representation', body: { title: `${title} by service key`, owner_id: a.id } });
      if (svc.json?.[0]?.id) ids.push(svc.json[0].id);
      const pa4 = await proposalRows(a);
      check('a proposal made with the service key (no signed-in member) is saved and scores nothing',
        svc.status === 201 && Array.isArray(svc.json) && svc.json.length === 1 && pa4.length === pa2.length,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${pa2.length} now ${pa4.length}`);
      if (made.json?.[0]?.id) {
        await call(`/rest/v1/proposals?id=eq.${made.json[0].id}`, { method: 'DELETE', token: a.token });
        const pa5 = await proposalRows(a);
        check('deleting a proposal records no "Made a proposal" engagement', pa5.length === pa4.length, `A had ${pa4.length} now ${pa5.length}`);
      }
      madeProposalPointsA = (await proposalRows(a)).reduce((sum, e) => sum + e.points, 0);
    } finally {
      if (ids.length) await admin(`/rest/v1/proposals?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Changing a proposal earns its point
  // (20261123170000_score_changed_a_proposal.sql, WC-193): a saved change to
  // a proposal's title, notes, points, priority, status or parent is scored
  // once for the member who made it, naming the tool the change sent; a save
  // that changes nothing, a reorder, a refused change, a sub-proposal losing a
  // deleted parent and a service-key change score nothing; nobody can write
  // the engagement themselves. Counts are taken at the start of the block, so
  // the changes the checks above made (the proposals check's one and the
  // "Made a proposal" block's one, both for A) do not matter here.
  let changedProposalPointsA = 0;
  {
    const PROPOSAL_KIND = 'changed_a_proposal';
    const proposalRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${PROPOSAL_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const proposalRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${PROPOSAL_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const ids = [];
    const patch = (id, member, body) => call(`/rest/v1/proposals?id=eq.${id}`, { method: 'PATCH', token: member.token, prefer: 'return=representation', body });
    try {
      const [pa, pb] = [await proposalRows(a), await proposalRows(b)];
      // The "Made a proposal" block above changes its proposal without sending a
      // tool, so that change keeps the row's own tool, rls-check-proposal-tool.
      check('each proposal change A made above recorded one engagement for them, worth what the rule says, naming its tool',
        pa.length >= 2 && pa.every((e) => e.points === proposalRule?.points && [TOOL, 'rls-check-proposal-tool'].includes(e.tool) && e.task_id === null),
        `A ${JSON.stringify(pa)}, B ${JSON.stringify(pb)}, rule ${proposalRule?.points}`);
      const title = `RLS changed proposal ${randomUUID().slice(0, 8)}`;
      const made = await call('/rest/v1/proposals', { method: 'POST', token: a.token, prefer: 'return=representation', body: { title } });
      const id = made.json?.[0]?.id;
      if (id) ids.push(id);
      const parent = await call('/rest/v1/proposals', { method: 'POST', token: a.token, prefer: 'return=representation', body: { title: `${title} parent` } });
      const parentId = parent.json?.[0]?.id;
      if (parentId) ids.push(parentId);
      const afterMaking = await proposalRows(a);
      const changed = id ? await patch(id, a, { title: `${title}, changed`, tool: 'rls-check-proposal-tool' }) : { status: 0 };
      const notes = id ? await patch(id, a, { notes: 'why', points: 2, priority: 'high', status: 'doing', tool: TOOL }) : { status: 0 };
      const reparent = id && parentId ? await patch(id, a, { parent_proposal_id: parentId, tool: TOOL }) : { status: 0 };
      const pa2 = await proposalRows(a);
      check('changing a proposal records exactly one engagement per saved change for the member who made it, naming the tool it sent; making one records none',
        made.status === 201 && afterMaking.length === pa.length && changed.status === 200 && notes.status === 200 && reparent.status === 200
          && pa2.length === pa.length + 3 && pa2.at(-3)?.tool === 'rls-check-proposal-tool' && pa2.at(-1)?.tool === TOOL && pa2.slice(-3).every((e) => e.points === proposalRule?.points),
        `made HTTP ${made.status}, change HTTP ${changed.status}/${notes.status}/${reparent.status}, A had ${pa.length} (${afterMaking.length} after making) now ${JSON.stringify(pa2)}`);
      const same = id ? await patch(id, a, { title: `${title}, changed`, points: 2, tool: TOOL }) : { status: 0 };
      const moved = id ? await patch(id, a, { position: 42 }) : { status: 0 };
      const blank = id ? await patch(id, a, { title: ' \n ' }) : { status: 0 };
      const hijack = id ? await patch(id, b, { title: 'Hijacked' }) : { status: 0 };
      const [pa3, pb3] = [await proposalRows(a), await proposalRows(b)];
      check('a save that changes nothing, a reorder, a refused change and another member\u2019s attempt record nothing',
        same.status === 200 && moved.status === 200 && blank.status >= 400 && hijack.status === 200 && hijack.json?.length === 0 && pa3.length === pa2.length && pb3.length === pb.length,
        `same HTTP ${same.status}, reorder HTTP ${moved.status}, blank HTTP ${blank.status}, B's HTTP ${hijack.status} ${JSON.stringify(hijack.json)}, A had ${pa2.length} now ${pa3.length}, B had ${pb.length} now ${pb3.length}`);
      check('"Changed a proposal" is active at 1 point with its four factors and a reason for each',
        proposalRule?.name === 'Changed a proposal' && proposalRule.points === 1 && proposalRule.effort === 1 && proposalRule.value === 1 && proposalRule.rarity === 0 && proposalRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof proposalRule[k] === 'string' && proposalRule[k].length > 0),
        JSON.stringify(proposalRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: PROPOSAL_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: PROPOSAL_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/proposals_score_changed', { method: 'POST', token: b.token, body: {} });
      const pb4 = await proposalRows(b);
      check('a member cannot forge a "Changed a proposal" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && pb4.length === pb.length,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, proposals_score_changed HTTP ${forgeTrigger.status}, B now ${pb4.length}`);
      const svc = id ? await admin(`/rest/v1/proposals?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { title: `${title} by service key` } }) : { status: 0 };
      const pa5 = await proposalRows(a);
      check('a change made with the service key (no signed-in member) is saved and scores nothing',
        svc.status === 200 && svc.json?.[0]?.title === `${title} by service key` && pa5.length === pa3.length,
        `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${pa3.length} now ${pa5.length}`);
      if (parentId) {
        const del = await call(`/rest/v1/proposals?id=eq.${parentId}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
        const child = id ? (await admin(`/rest/v1/proposals?id=eq.${id}&select=parent_proposal_id`)).json?.[0] : null;
        const pa6 = await proposalRows(a);
        check('deleting a proposal records no "Changed a proposal", not even for the sub-proposal that loses it as parent',
          del.json?.length === 1 && child?.parent_proposal_id === null && pa6.length === pa5.length, `delete ${JSON.stringify(del.json)}, child ${JSON.stringify(child)}, A had ${pa5.length} now ${pa6.length}`);
      }
      changedProposalPointsA = (await proposalRows(a)).reduce((sum, e) => sum + e.points, 0);
      // The two proposals this block made scored "Made a proposal" for A after
      // that block took its total, so take it again.
      madeProposalPointsA = ((await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_a_proposal&select=points`)).json ?? []).reduce((sum, e) => sum + e.points, 0);
    } finally {
      if (ids.length) await admin(`/rest/v1/proposals?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Deleting a proposal earns its point
  // (20261123180000_score_deleted_a_proposal.sql, WC-194): a proposal its
  // owner deletes is scored once for them, naming the tool the delete sent;
  // a refused delete, a sub-proposal losing its parent and a service-key
  // delete score nothing; nobody can write the engagement themselves. Counts
  // are taken at the start of the block, so the deletes the checks above made
  // (A's through core, and one each in the "Made a proposal" and "Changed a
  // proposal" checks) do not matter here. This block runs after those checks,
  // and the proposals it makes score "Made a proposal" for A, so it counts A's
  // made points again at the end.
  let deletedProposalPointsA = 0;
  {
    const DELETED_KIND = 'deleted_a_proposal';
    const deletedRows = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${DELETED_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const deletedRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${DELETED_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
    const ids = [];
    const make = async (member, body) => {
      const made = await call('/rest/v1/proposals', { method: 'POST', token: member.token, prefer: 'return=representation', body });
      const id = made.json?.[0]?.id;
      if (id) ids.push(id);
      return { status: made.status, id };
    };
    const remove = (id, member, tool) => call(`/rest/v1/proposals?id=eq.${id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation', tool });
    try {
      const [pa, pb] = [await deletedRows(a), await deletedRows(b)];
      check('the proposals A deleted above recorded one engagement each for them, worth what the rule says; the first, through core, names its tool',
        pa.length >= 1 && pa[0].tool === TOOL && pa.every((e) => e.points === deletedRule?.points && e.task_id === null),
        `A ${JSON.stringify(pa)}, B ${JSON.stringify(pb)}, rule ${deletedRule?.points}`);
      const title = `RLS deleted proposal ${randomUUID().slice(0, 8)}`;
      const parent = await make(a, { title: `${title} parent` });
      const child = await make(a, { title: `${title} child`, parent_proposal_id: parent.id });
      const plain = await make(a, { title });
      const theirs = await make(b, { title: `${title} B's` });
      const afterMaking = await deletedRows(a);
      const hijack = theirs.id ? await remove(theirs.id, a, TOOL) : { status: 0 };
      const afterHijack = [await deletedRows(a), await deletedRows(b)];
      const del = plain.id ? await remove(plain.id, a, 'rls-check-proposal-tool') : { status: 0 };
      const delParent = parent.id ? await remove(parent.id, a, TOOL) : { status: 0 };
      const orphan = child.id ? (await admin(`/rest/v1/proposals?id=eq.${child.id}&select=parent_proposal_id`)).json?.[0] : null;
      const pa2 = await deletedRows(a);
      check('deleting a proposal records exactly one engagement for the member who deleted it, naming the tool it sent; making one, or its sub-proposal losing it, records none',
        plain.status === 201 && afterMaking.length === pa.length && del.json?.length === 1 && delParent.json?.length === 1 && orphan?.parent_proposal_id === null
          && pa2.length === pa.length + 2 && pa2.at(-2)?.tool === 'rls-check-proposal-tool' && pa2.at(-1)?.tool === TOOL && pa2.slice(-2).every((e) => e.points === deletedRule?.points),
        `made HTTP ${plain.status}, delete ${JSON.stringify(del.json)}, parent ${JSON.stringify(delParent.json)}, child ${JSON.stringify(orphan)}, A had ${pa.length} (${afterMaking.length} after making) now ${JSON.stringify(pa2)}`);
      check('another member\u2019s attempt to delete a proposal deletes nothing and records nothing',
        hijack.status === 200 && hijack.json?.length === 0 && afterHijack[0].length === pa.length && afterHijack[1].length === pb.length,
        `HTTP ${hijack.status} ${JSON.stringify(hijack.json)}, A had ${pa.length} now ${afterHijack[0].length}, B had ${pb.length} now ${afterHijack[1].length}`);
      check('"Deleted a proposal" is active at 1 point with its four factors and a reason for each',
        deletedRule?.name === 'Deleted a proposal' && deletedRule.points === 1 && deletedRule.effort === 0 && deletedRule.value === 1 && deletedRule.rarity === 0 && deletedRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof deletedRule[k] === 'string' && deletedRule[k].length > 0),
        JSON.stringify(deletedRule));
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: DELETED_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: DELETED_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/proposals_score_delete', { method: 'POST', token: b.token, body: {} });
      const pb3 = await deletedRows(b);
      check('a member cannot forge a "Deleted a proposal" engagement: not in the ledger, not through the ledger\u2019s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && pb3.length === pb.length,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, proposals_score_delete HTTP ${forgeTrigger.status}, B now ${pb3.length}`);
      const svc = child.id ? await admin(`/rest/v1/proposals?id=eq.${child.id}`, { method: 'DELETE', prefer: 'return=representation' }) : { status: 0 };
      const pa4 = await deletedRows(a);
      check('a delete made with the service key (no signed-in member) goes through and scores nothing',
        svc.status === 200 && svc.json?.length === 1 && pa4.length === pa2.length, `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A had ${pa2.length} now ${pa4.length}`);
      deletedProposalPointsA = (await deletedRows(a)).reduce((sum, e) => sum + e.points, 0);
      madeProposalPointsA = (await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_a_proposal&select=points`)).json?.reduce((sum, e) => sum + e.points, 0) ?? madeProposalPointsA;
    } finally {
      if (ids.length) await admin(`/rest/v1/proposals?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // The website manager's two scoring actions (WC-213): A earns them in the
  // page blocks below, so A's ledger check further down reads them apart.
  const PAGE_KINDS = ['made_a_page', 'published_a_page'];

  // The website's pages (20261124120000_site_pages.sql, WC-206): only a role
  // with site.edit (admin; A is one, B a viewer) adds a page, in their own
  // name, always an empty draft; a draft is seen only by such a role, a
  // published page by anyone; an address is unique and well formed. Changing
  // and deleting a page are WC-207's block, below. The test rows are removed at the end.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const add = async (who, body) => {
      const r = await call('/rest/v1/site_pages', { method: 'POST', token: who?.token, prefer: 'return=representation', body });
      if (r.json?.[0]?.id) ids.push(r.json[0].id);
      return r;
    };
    try {
      const made = await add(a, { name: `RLS page ${tag}`, slug: `rls-page-${tag}` });
      const page = made.json?.[0];
      check('a website manager adds a page, stamped as theirs, an empty draft naming the tool',
        made.status === 201 && page?.created_by === a.id && page?.is_published === false && JSON.stringify(page?.layout_sections) === '[]' && page?.tool === 'wavecenter',
        `HTTP ${made.status} ${JSON.stringify(made.json)}`);
      const byB = await add(b, { name: `RLS page B ${tag}`, slug: `rls-page-b-${tag}` });
      const anonAdd = await add(null, { name: `RLS page anon ${tag}`, slug: `rls-page-anon-${tag}` });
      check('a member without Manage website, or a signed-out visitor, cannot add a page', byB.status >= 400 && anonAdd.status >= 400, `viewer HTTP ${byB.status}, signed out HTTP ${anonAdd.status}`);
      const forged = await add(a, { name: `RLS forged ${tag}`, slug: `rls-forged-${tag}`, is_published: true });
      const forgedBy = await add(a, { name: `RLS forged by ${tag}`, slug: `rls-forged-by-${tag}`, created_by: b.id });
      const forgedLayout = await add(a, { name: `RLS forged layout ${tag}`, slug: `rls-forged-layout-${tag}`, layout_sections: [{ id: 'x' }] });
      check('nobody adds a page already published, made in someone else’s name, or with sections', forged.status >= 400 && forgedBy.status >= 400 && forgedLayout.status >= 400,
        `published HTTP ${forged.status}, created_by HTTP ${forgedBy.status}, layout HTTP ${forgedLayout.status}`);
      const twin = await add(a, { name: `RLS twin ${tag}`, slug: `rls-page-${tag}` });
      const badSlug = await add(a, { name: `RLS bad ${tag}`, slug: 'Not A Slug' });
      const blank = await add(a, { name: ' \n ', slug: `rls-blank-${tag}` });
      const long = await add(a, { name: 'x'.repeat(81), slug: `rls-long-${tag}` });
      check('the database refuses a taken or badly formed address, a blank name and one over 80 characters',
        twin.status === 409 && badSlug.status >= 400 && blank.status >= 400 && long.status >= 400,
        `twin HTTP ${twin.status}, bad slug HTTP ${badSlug.status}, blank HTTP ${blank.status}, long HTTP ${long.status}`);
      const draftB = await call(`/rest/v1/site_pages?id=eq.${page?.id}&select=id`, { token: b.token });
      const draftAnon = await call(`/rest/v1/site_pages?id=eq.${page?.id}&select=id`);
      check('a draft is hidden from a member without Manage website and from a signed-out visitor',
        draftB.status === 200 && draftB.json?.length === 0 && draftAnon.status === 200 && draftAnon.json?.length === 0,
        `viewer HTTP ${draftB.status} ${JSON.stringify(draftB.json)}, signed out HTTP ${draftAnon.status} ${JSON.stringify(draftAnon.json)}`);
      await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', body: { is_published: true } });
      const pubB = await call(`/rest/v1/site_pages?id=eq.${page?.id}&select=id`, { token: b.token });
      const pubAnon = await call(`/rest/v1/site_pages?id=eq.${page?.id}&select=id`);
      check('a published page is seen by every member and by a signed-out visitor', pubB.json?.length === 1 && pubAnon.json?.length === 1,
        `viewer HTTP ${pubB.status} ${JSON.stringify(pubB.json)}, signed out HTTP ${pubAnon.status} ${JSON.stringify(pubAnon.json)}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/site_pages?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // The task permissions decide what each role does on tasks
  // (20261127130000_task_role_permissions.sql, WC-248): a reviewer or viewer
  // cannot add a task, even straight at the table; a contributor adds tasks
  // and changes and deletes only their own; an editor and an admin change and
  // delete anyone's; nobody but a task's owner changes its points, and nobody
  // changes its owner. One fresh member per role; they and their tasks go
  // with the other test users at the end.
  {
    const ROLE_KEYS = ['admin', 'editor', 'contributor', 'reviewer', 'viewer'];
    const by = {};
    for (const role of ROLE_KEYS) {
      const u = await makeUser(`task-${role}`);
      if (role !== 'contributor') {
        const set = await admin('/rest/v1/member_roles', { method: 'POST', body: { member_id: u.id, role, tool: TOOL } });
        if (set.status >= 300) throw new Error(`could not make the ${role} test member: HTTP ${set.status} ${JSON.stringify(set.json)}`);
      }
      by[role] = u;
    }
    const perms = (role) => memberPermissions(role);
    const an = (role) => (role === 'admin' || role === 'editor' ? `an ${role}` : `a ${role}`);
    const rowOf = async (id) => (await admin(`/rest/v1/tasks?id=eq.${id}&select=id,title,owner_id,points,owner_points`)).json?.[0];
    /** A task owned by `owner`, made with the service key so even a viewer can own one. */
    const seed = async (owner, title, points = 4) => {
      const made = await admin('/rest/v1/tasks', { method: 'POST', prefer: 'return=representation', body: { title, owner_id: owner.id, points, tool: TOOL } });
      if (made.status >= 300) throw new Error(`could not seed a task for ${owner.tag}: HTTP ${made.status} ${JSON.stringify(made.json)}`);
      return made.json[0].id;
    };
    const coreErr = (p) => p.then(() => '', (e) => e.message);

    // Adding.
    for (const role of ['reviewer', 'viewer']) {
      const u = by[role];
      const direct = await call('/rest/v1/tasks', { method: 'POST', token: u.token, prefer: 'return=representation', body: { title: `A ${role} adds straight at the table` } });
      const viaCore = await coreErr(createTask(u.store, { title: `A ${role} adds through core` }, TOOL, role, perms(role)));
      const left = await admin(`/rest/v1/tasks?owner_id=eq.${u.id}&select=id`);
      check(`a ${role}'s task is refused, straight at the table and through core, and nothing is added`,
        direct.status >= 400 && /Your role may not add tasks/.test(viaCore) && left.json?.length === 0,
        `direct HTTP ${direct.status} ${direct.json?.message ?? JSON.stringify(direct.json)}, core "${viaCore}", rows ${JSON.stringify(left.json)}`);
    }
    for (const role of ['admin', 'editor', 'contributor']) {
      const made = await createTask(by[role].store, { title: `A ${role}'s own task` }, TOOL, role, perms(role)).catch((e) => ({ error: e.message }));
      check(`${an(role)} adds a task through core, in their own name`, made.ownerId === by[role].id, JSON.stringify(made));
    }

    // Every role reads every task.
    const cTask = await seed(by.contributor, 'The contributor’s task');
    for (const role of ROLE_KEYS) {
      const read = await call(`/rest/v1/tasks?id=eq.${cTask}&select=id`, { token: by[role].token });
      check(`${an(role)} reads another member's task`, read.status === 200 && read.json?.length === 1, `HTTP ${read.status} ${JSON.stringify(read.json)}`);
    }

    // A contributor: their own, yes; someone else's, no.
    const own = await seed(by.contributor, 'Contributor edits this');
    const ownEdit = await updateTask(by.contributor.store, own, { title: 'Contributor edited this' }, TOOL, perms('contributor')).catch((e) => ({ error: e.message }));
    check('a contributor changes their own task through core', ownEdit.title === 'Contributor edited this', JSON.stringify(ownEdit));
    await deleteTask(by.contributor.store, own, TOOL, perms('contributor')).catch(() => {});
    check('a contributor deletes their own task through core', (await rowOf(own)) === undefined, JSON.stringify(await rowOf(own)));
    const eTask = await seed(by.editor, 'The editor’s task');
    const cEdit = await call(`/rest/v1/tasks?id=eq.${eTask}`, { method: 'PATCH', token: by.contributor.token, prefer: 'return=representation', body: { title: 'Contributor was here' } });
    const cDel = await call(`/rest/v1/tasks?id=eq.${eTask}`, { method: 'DELETE', token: by.contributor.token, prefer: 'return=representation' });
    const cCore = await coreErr(updateTask(by.contributor.store, eTask, { title: 'Contributor was here' }, TOOL, perms('contributor')));
    check("a contributor cannot change or delete another member's task, straight at the table or through core",
      cEdit.status === 200 && cEdit.json?.length === 0 && cDel.status === 200 && cDel.json?.length === 0 && /only your own tasks/.test(cCore) && (await rowOf(eTask))?.title === 'The editor’s task',
      `edit HTTP ${cEdit.status} ${JSON.stringify(cEdit.json)}, delete HTTP ${cDel.status} ${JSON.stringify(cDel.json)}, core "${cCore}"`);

    // A reviewer and a viewer change and delete nothing, not even their own.
    for (const role of ['reviewer', 'viewer']) {
      const theirs = await seed(by[role], `The ${role}’s own task`);
      const edit = await call(`/rest/v1/tasks?id=eq.${theirs}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { title: 'changed' } });
      const del = await call(`/rest/v1/tasks?id=eq.${theirs}`, { method: 'DELETE', token: by[role].token, prefer: 'return=representation' });
      const other = await call(`/rest/v1/tasks?id=eq.${cTask}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { title: 'changed' } });
      check(`a ${role} cannot change or delete their own task or anyone else's`,
        edit.json?.length === 0 && del.json?.length === 0 && other.json?.length === 0 && (await rowOf(theirs))?.title === `The ${role}’s own task`,
        `own edit ${JSON.stringify(edit.json)}, own delete ${JSON.stringify(del.json)}, other edit ${JSON.stringify(other.json)}`);
    }

    // An editor and an admin change and delete anyone's.
    for (const role of ['editor', 'admin']) {
      const target = await seed(by.contributor, `For the ${role} to change`);
      const changed = await updateTask(by[role].store, target, { title: `Changed by the ${role}`, priority: 'high' }, TOOL, perms(role)).catch((e) => ({ error: e.message }));
      check(`an ${role} changes another member's task through core, and it stays theirs`,
        changed.title === `Changed by the ${role}` && changed.ownerId === by.contributor.id, JSON.stringify(changed));
      const direct = await call(`/rest/v1/tasks?id=eq.${target}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { notes: `notes from the ${role}` } });
      check(`an ${role} changes another member's task straight at the table too`, direct.status === 200 && direct.json?.length === 1, `HTTP ${direct.status} ${JSON.stringify(direct.json)}`);
      await deleteTask(by[role].store, target, TOOL, perms(role)).catch(() => {});
      check(`an ${role} deletes another member's task through core`, (await rowOf(target)) === undefined, JSON.stringify(await rowOf(target)));
    }

    // Only the owner changes the points; nobody changes the owner.
    const pointed = await seed(by.contributor, 'Whose points?', 4);
    for (const role of ['editor', 'admin']) {
      const bump = await call(`/rest/v1/tasks?id=eq.${pointed}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { points: 40 } });
      const same = await call(`/rest/v1/tasks?id=eq.${pointed}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { points: 4 } });
      const steal = await call(`/rest/v1/tasks?id=eq.${pointed}`, { method: 'PATCH', token: by[role].token, prefer: 'return=representation', body: { owner_id: by[role].id } });
      const row = await rowOf(pointed);
      check(`an ${role} cannot change another member's task's points, even to the same number, or take it over`,
        bump.status >= 400 && /Only a task's owner can change its points/.test(bump.json?.message ?? '') && same.status >= 400
          && steal.status >= 400 && /owner cannot change/.test(steal.json?.message ?? '')
          && row?.points === 4 && row?.owner_points === 4 && row?.owner_id === by.contributor.id,
        `bump HTTP ${bump.status} ${bump.json?.message ?? ''}, same HTTP ${same.status}, steal HTTP ${steal.status} ${steal.json?.message ?? ''}, row ${JSON.stringify(row)}`);
    }
    const mine = await setPoints(by.contributor.store, pointed, 6, TOOL).then(() => rowOf(pointed), (e) => ({ error: e.message }));
    check('the owner still changes their own task’s points', mine?.points === 6 && mine?.owner_points === 6, JSON.stringify(mine));
    const selfSteal = await call(`/rest/v1/tasks?id=eq.${pointed}`, { method: 'PATCH', token: by.contributor.token, prefer: 'return=representation', body: { owner_id: by.editor.id } });
    check('the owner cannot hand their task to another member either', selfSteal.status >= 400 && (await rowOf(pointed))?.owner_id === by.contributor.id, `HTTP ${selfSteal.status} ${selfSteal.json?.message ?? ''}`);
    const vote = await castVote(voteStore(by.editor), pointed, { points: 10 }, TOOL).then(() => rowOf(pointed), (e) => ({ error: e.message }));
    check('a vote on another member’s task still lands on its points, and the owner’s score stays theirs', vote?.points === 8 && vote?.owner_points === 6, JSON.stringify(vote));
    const svc = await admin(`/rest/v1/tasks?id=eq.${pointed}`, { method: 'PATCH', prefer: 'return=representation', body: { points: 2 } });
    check('the service key still changes a task’s points', svc.status === 200 && svc.json?.[0]?.owner_points === 2, `HTTP ${svc.status} ${JSON.stringify(svc.json)}`);
  }

  // Changing, publishing and deleting a page (20261124130000_site_pages_edit.sql,
  // WC-207): only a role with site.edit (A) renames a page, gives it a new
  // address or publishes it, and the change time is stamped; nobody changes
  // who made it, when or the tool (its sections are WC-208's, below); an address another page uses
  // is refused; only such a role deletes a page. B (a viewer) and a
  // signed-out visitor can do none of it. The test rows are removed at the end.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const make = async (slug) => {
      const r = await call('/rest/v1/site_pages', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: `RLS edit ${slug}`, slug } });
      if (r.json?.[0]?.id) ids.push(r.json[0].id);
      return r.json?.[0];
    };
    const patch = (who, id, body) => call(`/rest/v1/site_pages?id=eq.${id}`, { method: 'PATCH', token: who?.token, prefer: 'return=representation', body });
    const del = (who, id) => call(`/rest/v1/site_pages?id=eq.${id}`, { method: 'DELETE', token: who?.token, prefer: 'return=representation' });
    const row = async (id) => (await admin(`/rest/v1/site_pages?id=eq.${id}&select=*`)).json?.[0];
    const refused = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
    try {
      const page = await make(`rls-edit-${tag}`);
      const other = await make(`rls-edit-other-${tag}`);
      check('WC-207 test pages were made', Boolean(page?.id && other?.id), JSON.stringify({ page, other }));
      await new Promise((r) => setTimeout(r, 20));
      const renamed = await patch(a, page?.id, { name: `RLS renamed ${tag}`, slug: `rls-renamed-${tag}`, is_published: true });
      const after = renamed.json?.[0];
      check('a website manager renames a page, gives it a new address and publishes it, and the change time is stamped',
        renamed.status === 200 && after?.name === `RLS renamed ${tag}` && after?.slug === `rls-renamed-${tag}` && after?.is_published === true
          && after?.created_by === a.id && after?.created_at === page?.created_at && after?.updated_at > page?.updated_at,
        `HTTP ${renamed.status} ${JSON.stringify(after)}`);
      const draft = await patch(a, page?.id, { is_published: false });
      check('a website manager takes a page back to a draft', draft.status === 200 && draft.json?.[0]?.is_published === false, `HTTP ${draft.status} ${JSON.stringify(draft.json)}`);
      const forgedBy = await patch(a, page?.id, { created_by: b.id });
      const forgedAt = await patch(a, page?.id, { created_at: '2000-01-01T00:00:00Z' });
      const forgedTool = await patch(a, page?.id, { tool: 'forged' });
      const kept = await row(page?.id);
      check('nobody changes who made a page, when or the tool',
        forgedBy.status >= 400 && forgedAt.status >= 400 && forgedTool.status >= 400
          && kept?.created_by === a.id && kept?.created_at === page?.created_at && kept?.tool === 'wavecenter',
        `created_by HTTP ${forgedBy.status}, created_at HTTP ${forgedAt.status}, tool HTTP ${forgedTool.status}, row ${JSON.stringify(kept)}`);
      const twin = await patch(a, page?.id, { slug: `rls-edit-other-${tag}` });
      const badSlug = await patch(a, page?.id, { slug: 'Not A Slug' });
      const blank = await patch(a, page?.id, { name: '  ' });
      check('the database refuses a change to a taken or badly formed address, or a blank name',
        twin.status === 409 && badSlug.status >= 400 && blank.status >= 400, `twin HTTP ${twin.status}, bad slug HTTP ${badSlug.status}, blank HTTP ${blank.status}`);
      await admin(`/rest/v1/site_pages?id=eq.${other?.id}`, { method: 'PATCH', body: { is_published: true } });
      const bPatch = await patch(b, other?.id, { name: 'changed by B', is_published: false });
      const anonPatch = await patch(null, other?.id, { name: 'changed signed out' });
      const bDel = await del(b, other?.id);
      const anonDel = await del(null, other?.id);
      const otherKept = await row(other?.id);
      check('a member without Manage website, or a signed-out visitor, cannot change, unpublish or delete a page, even a published one',
        refused(bPatch) && refused(anonPatch) && refused(bDel) && refused(anonDel) && otherKept?.name === `RLS edit rls-edit-other-${tag}` && otherKept?.is_published === true,
        `viewer patch HTTP ${bPatch.status}, signed out patch HTTP ${anonPatch.status}, viewer delete HTTP ${bDel.status}, signed out delete HTTP ${anonDel.status}, row ${JSON.stringify(otherKept)}`);
      const aDel = await del(a, page?.id);
      check('a website manager deletes a page', aDel.status === 200 && aDel.json?.length === 1 && (await row(page?.id)) === undefined,
        `HTTP ${aDel.status} ${JSON.stringify(aDel.json)}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/site_pages?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // A page's sections (20261124140000_site_pages_sections.sql, WC-208): only a
  // role with site.edit (A) saves them, the change time is stamped, and the
  // database holds them to a list of at most 50 sections and 200000 bytes,
  // the limits core uses. B (a viewer) and a signed-out visitor cannot change
  // them, even on a published page. The test rows are removed at the end.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const patch = (who, id, body) => call(`/rest/v1/site_pages?id=eq.${id}`, { method: 'PATCH', token: who?.token, prefer: 'return=representation', body });
    const row = async (id) => (await admin(`/rest/v1/site_pages?id=eq.${id}&select=*`)).json?.[0];
    const refused = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
    const section = (id, layout) => ({ id, title: '', layout, alignment: 'left', marginTop: 0, marginBottom: 0, background: '' });
    try {
      const made = await call('/rest/v1/site_pages', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: `RLS sections ${tag}`, slug: `rls-sections-${tag}` } });
      const page = made.json?.[0];
      if (page?.id) ids.push(page.id);
      check('WC-208 test page was made', Boolean(page?.id), `HTTP ${made.status} ${JSON.stringify(made.json)}`);
      await new Promise((r) => setTimeout(r, 20));
      const three = [section('b', 'two-column'), section('a', 'single'), section('c', 'three-column')];
      const saved = await patch(a, page?.id, { layout_sections: three });
      const after = saved.json?.[0];
      check('a website manager saves a page\'s sections, in order, and the change time is stamped',
        saved.status === 200 && JSON.stringify(after?.layout_sections?.map((s) => s.id)) === '["b","a","c"]' && after?.updated_at > page?.updated_at,
        `HTTP ${saved.status} ${JSON.stringify(after)}`);
      const tooMany = await patch(a, page?.id, { layout_sections: Array.from({ length: 51 }, (_, i) => section(`s${i}`, 'single')) });
      const fifty = await patch(a, page?.id, { layout_sections: Array.from({ length: 50 }, (_, i) => section(`s${i}`, 'single')) });
      const tooBig = await patch(a, page?.id, { layout_sections: [{ ...section('big', 'single'), title: 'x'.repeat(200001) }] });
      const notList = await patch(a, page?.id, { layout_sections: { id: 'x' } });
      check('the database keeps a page\'s sections a list of at most 50 sections and 200000 bytes',
        tooMany.status === 400 && fifty.status === 200 && tooBig.status === 400 && notList.status >= 400,
        `51 HTTP ${tooMany.status}, 50 HTTP ${fifty.status}, too big HTTP ${tooBig.status}, not a list HTTP ${notList.status}`);
      await patch(a, page?.id, { layout_sections: three, is_published: true });
      const bPatch = await patch(b, page?.id, { layout_sections: [] });
      const anonPatch = await patch(null, page?.id, { layout_sections: [] });
      const kept = await row(page?.id);
      check('a member without Manage website, or a signed-out visitor, cannot change a page\'s sections, even a published one',
        refused(bPatch) && refused(anonPatch) && kept?.layout_sections?.length === 3,
        `viewer HTTP ${bPatch.status}, signed out HTTP ${anonPatch.status}, row ${JSON.stringify(kept)}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/site_pages?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Making and publishing a page earn their points (20261124150000_score_made_a_page.sql,
  // WC-213): a page made earns "Made a page" for its maker, naming its tool;
  // a change from draft to published earns "Published a page" for the member
  // who published it, naming the tool in the request's header. A refused
  // write, a rename, saving a published page as published, and a
  // service-key write earn nothing. Counted relative to the blocks above,
  // which already scored A's pages. The test rows are removed at the end.
  {
    const ids = [];
    const tag = randomUUID().slice(0, 8);
    const scores = async (member, kind) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${kind}&select=points,tool,task_id&order=created_at`)).json ?? [];
    const keep = (r) => { if (r.json?.[0]?.id) ids.push(r.json[0].id); return r.json?.[0]; };
    const patch = (who, id, body, tool) => call(`/rest/v1/site_pages?id=eq.${id}`, { method: 'PATCH', token: who?.token, prefer: 'return=representation', body, tool });
    try {
      const rules = (await admin(`/rest/v1/game_scoring_rules?kind=in.(${PAGE_KINDS.join(',')})&select=kind,name,points,effort,value,rarity,farm_risk&order=position`)).json ?? [];
      check('"Made a page" and "Published a page" are listed on Game → Manage at 1 point, their factors left to score',
        JSON.stringify(rules.map((r) => [r.kind, r.name, r.points, r.effort, r.value, r.rarity, r.farm_risk]))
          === JSON.stringify([['made_a_page', 'Made a page', 1, null, null, null, null], ['published_a_page', 'Published a page', 1, null, null, null, null]]),
        JSON.stringify(rules));
      const madeA0 = await scores(a, 'made_a_page');
      const madeB0 = await scores(b, 'made_a_page');
      const pubA0 = await scores(a, 'published_a_page');

      const page = keep(await call('/rest/v1/site_pages', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: `RLS score ${tag}`, slug: `rls-score-${tag}`, tool: 'rls-page-tool' } }));
      keep(await call('/rest/v1/site_pages', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: `RLS score twin ${tag}`, slug: `rls-score-${tag}` } }));
      keep(await call('/rest/v1/site_pages', { method: 'POST', token: b.token, prefer: 'return=representation', body: { name: `RLS score B ${tag}`, slug: `rls-score-b-${tag}` } }));
      keep(await admin('/rest/v1/site_pages', { method: 'POST', prefer: 'return=representation', body: { name: `RLS score key ${tag}`, slug: `rls-score-key-${tag}` } }));
      const madeA1 = await scores(a, 'made_a_page');
      const madeB1 = await scores(b, 'made_a_page');
      const newMade = madeA1.slice(madeA0.length);
      check('making a page earns its maker one "Made a page", naming the tool; a taken address, a viewer\'s page and a service-key page earn nothing',
        Boolean(page?.id) && newMade.length === 1 && newMade[0].points === 1 && newMade[0].tool === 'rls-page-tool' && newMade[0].task_id === null && madeB1.length === madeB0.length,
        `A's new ${JSON.stringify(newMade)}, B before ${madeB0.length} after ${madeB1.length}`);

      await patch(a, page?.id, { name: `RLS score renamed ${tag}` }, 'rls-rename-tool');
      await patch(b, page?.id, { is_published: true }, 'rls-viewer-tool');
      const pubA1 = await scores(a, 'published_a_page');
      const pubB1 = await scores(b, 'published_a_page');
      check('renaming a draft, or a viewer trying to publish it, earns no "Published a page"', pubA1.length === pubA0.length && pubB1.length === 0,
        `A before ${pubA0.length} after ${pubA1.length}, B ${pubB1.length}`);

      const published = await patch(a, page?.id, { is_published: true }, 'rls-publish-tool');
      await patch(a, page?.id, { is_published: true, name: `RLS score again ${tag}` }, 'rls-publish-tool');
      const pubA2 = await scores(a, 'published_a_page');
      const newPub = pubA2.slice(pubA0.length);
      check('publishing a draft earns the member who published it one "Published a page", naming the tool that sent it; saving it published again earns nothing',
        published.status === 200 && published.json?.[0]?.is_published === true && newPub.length === 1 && newPub[0].points === 1 && newPub[0].tool === 'rls-publish-tool' && newPub[0].task_id === null,
        `HTTP ${published.status}, A's new ${JSON.stringify(newPub)}`);

      await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', body: { is_published: false } });
      const byKey = await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', prefer: 'return=representation', body: { is_published: true } });
      const pubA3 = await scores(a, 'published_a_page');
      check('a service-key publish is saved and earns nobody "Published a page"', byKey.status === 200 && byKey.json?.[0]?.is_published === true && pubA3.length === pubA2.length,
        `HTTP ${byKey.status} ${JSON.stringify(byKey.json)}, A before ${pubA2.length} after ${pubA3.length}`);
    } finally {
      if (ids.length) await admin(`/rest/v1/site_pages?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    }
  }

  // Saved sections reused on many pages (20261124160000_site_sections.sql,
  // WC-212): only a role with site.edit (A) saves one, stamped as theirs, or
  // changes its content, with the change time stamped; B (a viewer) and a
  // signed-out visitor can do neither, and nobody changes who saved it. A
  // website manager reads every original; anyone else reads only one a
  // published page follows (linked true), never one only a draft or a plain
  // copy names. Renaming and deleting one (20261127120000_site_sections_rename_delete.sql,
  // WC-246): A renames and deletes; B and a visitor do neither; a blank or
  // 81-character name is refused. The test rows are removed at the end.
  {
    const pageIds = [];
    const sectionIds = [];
    const tag = randomUUID().slice(0, 8);
    const content = (layout) => ({ id: 'section', title: '', layout, alignment: 'left', marginTop: 0, marginBottom: 0, background: '' });
    const save = async (who, body) => {
      const r = await call('/rest/v1/site_sections', { method: 'POST', token: who?.token, prefer: 'return=representation', body });
      if (r.json?.[0]?.id) sectionIds.push(r.json[0].id);
      return r;
    };
    const patch = (who, id, body) => call(`/rest/v1/site_sections?id=eq.${id}`, { method: 'PATCH', token: who?.token, prefer: 'return=representation', body });
    const row = async (id) => (await admin(`/rest/v1/site_sections?id=eq.${id}&select=*`)).json?.[0];
    const sees = async (who, id) => (await call(`/rest/v1/site_sections?id=eq.${id}&select=id`, { token: who?.token })).json?.length === 1;
    const refused = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
    try {
      const made = await save(a, { name: `RLS header ${tag}`, section: content('two-column') });
      const original = made.json?.[0];
      check('a website manager saves a reusable section, stamped as theirs, naming the tool',
        made.status === 201 && original?.created_by === a.id && original?.tool === 'wavecenter' && original?.section?.layout === 'two-column',
        `HTTP ${made.status} ${JSON.stringify(made.json)}`);
      const byB = await save(b, { name: `RLS B ${tag}`, section: content('single') });
      const byAnon = await save(null, { name: `RLS anon ${tag}`, section: content('single') });
      const forgedBy = await save(a, { name: `RLS forged ${tag}`, section: content('single'), created_by: b.id });
      check('a member without Manage website, or a signed-out visitor, cannot save a reusable section; nobody saves one in someone else\'s name',
        byB.status >= 400 && byAnon.status >= 400 && forgedBy.status >= 400, `viewer HTTP ${byB.status}, signed out HTTP ${byAnon.status}, created_by HTTP ${forgedBy.status}`);
      const blank = await save(a, { name: '  ', section: content('single') });
      const long = await save(a, { name: 'x'.repeat(81), section: content('single') });
      const notObject = await save(a, { name: `RLS list ${tag}`, section: [content('single')] });
      const tooBig = await save(a, { name: `RLS big ${tag}`, section: { ...content('single'), title: 'x'.repeat(50001) } });
      check('the database refuses a blank name, one over 80 characters, content that is not one section, and one over 50000 bytes',
        blank.status >= 400 && long.status >= 400 && notObject.status >= 400 && tooBig.status >= 400,
        `blank HTTP ${blank.status}, long HTTP ${long.status}, list HTTP ${notObject.status}, too big HTTP ${tooBig.status}`);

      await new Promise((r) => setTimeout(r, 20));
      const changed = await patch(a, original?.id, { section: content('three-column') });
      check('a website manager changes a saved section\'s content, and the change time is stamped',
        changed.status === 200 && changed.json?.[0]?.section?.layout === 'three-column' && changed.json?.[0]?.updated_at > original?.updated_at,
        `HTTP ${changed.status} ${JSON.stringify(changed.json)}`);
      const bPatch = await patch(b, original?.id, { section: content('single') });
      const anonPatch = await patch(null, original?.id, { section: content('single') });
      const forgedPatch = await patch(a, original?.id, { created_by: b.id });
      const kept = await row(original?.id);
      check('a member without Manage website, or a signed-out visitor, cannot change a saved section; nobody changes who saved it',
        refused(bPatch) && refused(anonPatch) && forgedPatch.status >= 400
          && kept?.section?.layout === 'three-column' && kept?.created_by === a.id && kept?.name === `RLS header ${tag}`,
        `viewer HTTP ${bPatch.status}, signed out HTTP ${anonPatch.status}, created_by HTTP ${forgedPatch.status}, row ${JSON.stringify(kept)}`);

      check('an original no page follows is read by a website manager only', (await sees(a, original?.id)) && !(await sees(b, original?.id)) && !(await sees(null, original?.id)), '');
      const instance = (linked) => ({ id: `s-${linked}`, title: '', layout: 'single', alignment: 'left', marginTop: 0, marginBottom: 0, background: '', savedSectionId: original?.id, linked });
      const page = (await call('/rest/v1/site_pages', { method: 'POST', token: a.token, prefer: 'return=representation', body: { name: `RLS follows ${tag}`, slug: `rls-follows-${tag}` } })).json?.[0];
      if (page?.id) pageIds.push(page.id);
      await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', body: { layout_sections: [instance(false)], is_published: true } });
      check('a published page holding only a plain copy does not let a visitor read the original', !(await sees(b, original?.id)) && !(await sees(null, original?.id)), '');
      await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', body: { layout_sections: [instance(true)], is_published: false } });
      check('a draft page that follows it does not let a visitor read the original', !(await sees(b, original?.id)) && !(await sees(null, original?.id)), '');
      await admin(`/rest/v1/site_pages?id=eq.${page?.id}`, { method: 'PATCH', body: { is_published: true } });
      check('once a published page follows it, every member and a signed-out visitor read the original', (await sees(b, original?.id)) && (await sees(null, original?.id)), '');

      // WC-246: renaming and deleting. B and a visitor can now read the original (a published page follows it), so a refusal here is the policy, not a hidden row.
      const del = (who, id) => call(`/rest/v1/site_sections?id=eq.${id}`, { method: 'DELETE', token: who?.token, prefer: 'return=representation' });
      const bRename = await patch(b, original?.id, { name: `RLS B rename ${tag}` });
      const anonRename = await patch(null, original?.id, { name: `RLS anon rename ${tag}` });
      const bDel = await del(b, original?.id);
      const anonDel = await del(null, original?.id);
      const stillThere = await row(original?.id);
      check('a member without Manage website, or a signed-out visitor, cannot rename or delete a saved section',
        refused(bRename) && refused(anonRename) && refused(bDel) && refused(anonDel) && stillThere?.name === `RLS header ${tag}`,
        `viewer rename HTTP ${bRename.status}, signed out rename HTTP ${anonRename.status}, viewer delete HTTP ${bDel.status}, signed out delete HTTP ${anonDel.status}, row ${JSON.stringify(stillThere)}`);
      const blankName = await patch(a, original?.id, { name: '   ' });
      const longName = await patch(a, original?.id, { name: 'x'.repeat(81) });
      check('the database refuses renaming a saved section to a blank name or one over 80 characters',
        blankName.status >= 400 && longName.status >= 400 && (await row(original?.id))?.name === `RLS header ${tag}`,
        `blank HTTP ${blankName.status}, long HTTP ${longName.status}`);
      await new Promise((r) => setTimeout(r, 20));
      const aRename = await patch(a, original?.id, { name: `RLS site header ${tag}` });
      check('a website manager renames a saved section, and the change time is stamped',
        aRename.status === 200 && aRename.json?.[0]?.name === `RLS site header ${tag}` && aRename.json?.[0]?.updated_at > stillThere?.updated_at && aRename.json?.[0]?.created_by === a.id,
        `HTTP ${aRename.status} ${JSON.stringify(aRename.json)}`);
      const aDel = await del(a, original?.id);
      check('a website manager deletes a saved section', aDel.status === 200 && aDel.json?.length === 1 && (await row(original?.id)) === undefined,
        `HTTP ${aDel.status} ${JSON.stringify(aDel.json)}`);
    } finally {
      if (pageIds.length) await admin(`/rest/v1/site_pages?id=in.(${pageIds.join(',')})`, { method: 'DELETE' });
      if (sectionIds.length) await admin(`/rest/v1/site_sections?id=in.(${sectionIds.join(',')})`, { method: 'DELETE' });
    }
  }

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

  // task_comments: every member reads every comment and may post on any task;
  // a member edits and removes only their own (Dane, 2026-11-12, WC-172).
  // B listens live from here on, and so does a signed-out visitor.
  const liveB = await listenToComments(b.token, insA.id);
  const liveAnon = await listenToComments(null, insA.id);
  check('B can listen live to the comments on A’s task', liveB.status === 'LISTENING', `the live connection said ${liveB.status}`);

  const commentA = await addComment(a.store, commentStore(a), insA.id, 'A’s comment', TOOL);
  check('A can comment on A’s own task through core', commentA.ownerId === a.id && commentA.tool === TOOL, JSON.stringify(commentA));

  const commentsB = await call(`/rest/v1/task_comments?id=eq.${commentA.id}&select=body`, { token: b.token });
  check('B can read A’s comment', commentsB.status === 200 && commentsB.json?.[0]?.body === 'A’s comment', `sees ${JSON.stringify(commentsB.json)}`);

  const heardB = await liveB.waitFor((e) => e.eventType === 'INSERT' && e.new?.id === commentA.id);
  check('B hears A’s new comment live, once', heardB.length === 1 && heardB[0].new.body === 'A’s comment', `heard ${JSON.stringify(liveB.events)}`);

  const editB = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { body: 'taken over' } });
  check('B cannot change A’s comment', editB.status === 200 && editB.json.length === 0, `HTTP ${editB.status} ${JSON.stringify(editB.json)}`);

  const delCommentB = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('B cannot delete A’s comment', delCommentB.status === 200 && delCommentB.json.length === 0, `HTTP ${delCommentB.status} ${JSON.stringify(delCommentB.json)}`);

  const forgeCommentOwner = await call('/rest/v1/task_comments', { method: 'POST', token: b.token, body: { task_id: insA.id, owner_id: a.id, body: 'in A’s name' } });
  check('B cannot add a comment in A’s name', forgeCommentOwner.status >= 400, `HTTP ${forgeCommentOwner.status} ${forgeCommentOwner.json?.message ?? ''}`);

  let refusedComment = '';
  try { await editComment(commentStore(b), commentA.id, 'taken over', TOOL); } catch (err) { refusedComment = err.message; }
  check('B cannot change A’s comment through core either', /No comment .* you may change/.test(refusedComment), refusedComment || 'the change went through');
  refusedComment = '';
  try { await removeComment(commentStore(b), commentA.id, TOOL); } catch (err) { refusedComment = err.message; }
  check('B cannot remove A’s comment through core either', /No comment .* you may remove/.test(refusedComment), refusedComment || 'the remove went through');
  const commentB = await addComment(readableTasks(b), commentStore(b), insA.id, 'B on A’s task', TOOL);
  check('B can comment on A’s task through core, in B’s own name', commentB.ownerId === b.id && commentB.taskId === insA.id, JSON.stringify(commentB));
  const seenByA = await call(`/rest/v1/task_comments?id=eq.${commentB.id}&select=body`, { token: a.token });
  check('A can read B’s comment on A’s task', seenByA.json?.[0]?.body === 'B on A’s task', JSON.stringify(seenByA.json));
  let refusedOnNothing = '';
  try { await addComment(readableTasks(b), commentStore(b), randomUUID(), 'on no task', TOOL); } catch (err) { refusedOnNothing = err.message; }
  check('nobody can comment on a task that does not exist', /No task .* you may comment on/.test(refusedOnNothing), refusedOnNothing || 'the comment went through');
  const editOwnB = await editComment(commentStore(b), commentB.id, 'B on A’s task, edited', TOOL);
  check('B can edit B’s own comment on A’s task', editOwnB.body === 'B on A’s task, edited', JSON.stringify(editOwnB));
  const editByA = await call(`/rest/v1/task_comments?id=eq.${commentB.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { body: 'the task owner rewrote it' } });
  check('A cannot change B’s comment, even on A’s own task', editByA.status === 200 && editByA.json.length === 0, `HTTP ${editByA.status} ${JSON.stringify(editByA.json)}`);
  const delByA = await call(`/rest/v1/task_comments?id=eq.${commentB.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  check('A cannot delete B’s comment, even on A’s own task', delByA.status === 200 && delByA.json.length === 0, `HTTP ${delByA.status} ${JSON.stringify(delByA.json)}`);
  await removeComment(commentStore(b), commentB.id, TOOL);

  const moveComment = await call(`/rest/v1/task_comments?id=eq.${commentA.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { task_id: taskB } });
  check('A cannot move A’s comment onto another task', moveComment.status >= 400, `HTTP ${moveComment.status} ${moveComment.json?.message ?? JSON.stringify(moveComment.json)}`);

  const anonComments = await call('/rest/v1/task_comments?select=body');
  check('a signed-out visitor sees no comments', anonComments.status >= 400 || (Array.isArray(anonComments.json) && anonComments.json.length === 0), `HTTP ${anonComments.status}`);

  const editedA = await editComment(commentStore(a), commentA.id, 'A’s comment, edited', TOOL);
  const stillComment = await admin(`/rest/v1/task_comments?id=eq.${commentA.id}&select=body,owner_id,task_id`);
  check('A can edit A’s own comment through core, and only A’s change landed', editedA.body === 'A’s comment, edited' && stillComment.json?.[0]?.task_id === insA.id && stillComment.json?.[0]?.owner_id === a.id,
    JSON.stringify(stillComment.json));
  const editsOf = async () => (await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.edited_a_comment&select=task_id,tool,points`)).json;
  const editsOnce = await editsOf();
  await editComment(commentStore(a), commentA.id, 'A’s comment, edited', TOOL);
  const editsAfterSame = await editsOf();
  check('editing a comment scores it once, for its writer, on its task; a save that changes nothing is not scored',
    editsOnce?.length === 1 && editsOnce[0].task_id === insA.id && editsOnce[0].tool === TOOL && editsOnce[0].points === 1 && editsAfterSame?.length === 1,
    `after the edit ${JSON.stringify(editsOnce)}, after saving the same words ${JSON.stringify(editsAfterSame)}`);

  // Heard before the delete: Realtime checks an edited row as it sends it, so
  // an edit followed at once by a delete is never sent (harmless on screen:
  // the comment is gone either way).
  const heardEdit = await liveB.waitFor((e) => e.eventType === 'UPDATE' && e.new?.id === commentA.id);
  check('B hears A’s edit live', heardEdit.length >= 1 && heardEdit.at(-1).new.body === 'A’s comment, edited', `heard ${JSON.stringify(liveB.events)}`);

  await removeComment(commentStore(a), commentA.id, TOOL);
  const goneComment = await admin(`/rest/v1/task_comments?id=eq.${commentA.id}&select=id`);
  check('A can remove A’s own comment through core', goneComment.json?.length === 0, JSON.stringify(goneComment.json));

  const heardDelete = await liveB.waitFor((e) => e.eventType === 'DELETE' && e.old?.id === commentA.id);
  check('B hears A’s delete live, and it names only the comment, never its words', heardDelete.length >= 1 && heardDelete.every((e) => e.old.body === undefined), `heard ${JSON.stringify(heardDelete)}`);
  check('a signed-out visitor hears nothing live', liveAnon.events.length === 0, `the live connection said ${liveAnon.status}; heard ${JSON.stringify(liveAnon.events)}`);
  await liveB.stop();
  await liveAnon.stop();

  // Posting a comment is scored by the table's trigger: once, for the writer.
  const postedA = await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.posted_a_comment&select=points,tool,task_id`);
  check('posting a comment records one engagement, credited to the writer, naming the tool and the task, and editing or removing it records none',
    JSON.stringify(postedA.json) === JSON.stringify([{ points: 1, tool: TOOL, task_id: insA.id }]), JSON.stringify(postedA.json));
  const postedB = await admin(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.posted_a_comment&select=task_id`);
  check('B’s comment on A’s task is credited to B, once; the one refused records nothing', JSON.stringify(postedB.json) === JSON.stringify([{ task_id: insA.id }]), JSON.stringify(postedB.json));

  // A comment's files: readable by every member, as the comment is; attached
  // only by its writer, on their own task; gone with the comment.
  const noteA = await addComment(a.store, commentStore(a), insA.id, 'A’s comment with a file', TOOL);
  const notePath = commentFilePath(a.id, insA.id, randomUUID(), 'a-mock.txt');
  storedPaths.push(notePath);
  const upNote = await upload(a, notePath, 'A’s comment file');
  check('A can upload a file into A’s own comments folder', upNote.status === 200, `HTTP ${upNote.status} ${JSON.stringify(upNote.json)}`);
  const noteFile = await attachFile(a.store, fileStore(a), { taskId: insA.id, path: notePath, name: 'a-mock.txt', contentType: 'text/plain', sizeBytes: 17, commentId: noteA.id }, TOOL, commentStore(a));
  check('A can attach it to A’s own comment through core', noteFile.commentId === noteA.id && noteFile.ownerId === a.id, JSON.stringify(noteFile));

  const noteRowB = await call(`/rest/v1/task_files?id=eq.${noteFile.id}&select=name`, { token: b.token });
  check('B can see A’s comment file row', noteRowB.status === 200 && noteRowB.json?.[0]?.name === 'a-mock.txt', `sees ${JSON.stringify(noteRowB.json)}`);
  const noteReadB = await call(`/storage/v1/object/authenticated/${BUCKET}/${notePath}`, { token: b.token });
  check('B can read A’s stored comment file', noteReadB.status === 200, `HTTP ${noteReadB.status}`);
  const noteSignB = await call(`/storage/v1/object/sign/${BUCKET}/${notePath}`, { method: 'POST', token: b.token, body: { expiresIn: 60 } });
  check('B can get a link to A’s stored comment file', noteSignB.status === 200, `HTTP ${noteSignB.status} ${JSON.stringify(noteSignB.json)}`);
  const anonNote = await call(`/storage/v1/object/authenticated/${BUCKET}/${notePath}`);
  check('a signed-out visitor cannot read A’s stored comment file', anonNote.status >= 400, `HTTP ${anonNote.status}`);
  const ownNoteB = await addComment(readableTasks(b), commentStore(b), insA.id, 'B wants to attach here', TOOL);
  const ownNotePath = commentFilePath(b.id, insA.id, randomUUID(), 'b.txt');
  const onOwnNoteB = await call('/rest/v1/task_files', { method: 'POST', token: b.token, body: { task_id: insA.id, comment_id: ownNoteB.id, path: ownNotePath, name: 'b.txt', size_bytes: 1 } });
  check('B cannot attach a file to B’s own comment on A’s task (files only on your own tasks)', onOwnNoteB.status >= 400, `HTTP ${onOwnNoteB.status} ${onOwnNoteB.json?.message ?? ''}`);
  await removeComment(commentStore(b), ownNoteB.id, TOOL);
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
  // evolution_credits(): a card credits the owner of its WaveCenter task,
  // with the task's points, the avatar, and the name only from a Public
  // profile (A is Public, B is Private). Never the bio; never signed out.
  const pointsA = (await admin(`/rest/v1/tasks?id=eq.${insA.id}&select=points`)).json?.[0]?.points;
  const credit = async () => {
    const got = await call('/rest/v1/rpc/evolution_credits', { method: 'POST', token: b.token, body: {} });
    return { status: got.status, row: Array.isArray(got.json) ? got.json.find((r) => r.commit_sha === evoSha) : got.json };
  };
  await admin(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}`, { method: 'PATCH', body: { task_id: insA.id } });
  const creditA = await credit();
  check('a card credits its task’s owner and points, with the name of a Public profile and never the bio',
    creditA.status === 200 && typeof pointsA === 'number' && creditA.row?.points === pointsA && creditA.row?.avatar === 'sun' && creditA.row?.display_name === 'A' && !('bio' in (creditA.row ?? {})),
    `task points ${pointsA}, HTTP ${creditA.status} ${JSON.stringify(creditA.row)}`);
  await admin(`/rest/v1/evolution_entries?commit_sha=eq.${evoSha}`, { method: 'PATCH', body: { task_id: taskB } });
  const creditB = await credit();
  check('a card shows a Private owner\'s points alone, never their avatar, name or privacy setting', creditB.status === 200 && creditB.row?.avatar === null && creditB.row?.display_name === null && !('visibility' in (creditB.row ?? {})),
    `HTTP ${creditB.status} ${JSON.stringify(creditB.row)}`);
  const creditAnon = await call('/rest/v1/rpc/evolution_credits', { method: 'POST', body: {} });
  check('a signed-out visitor cannot read who made each change', creditAnon.status >= 400, `HTTP ${creditAnon.status} ${JSON.stringify(creditAnon.json)}`);

  // leaderboard(): every member's totals (Granular, Globular, Tasks) and what
  // their profile lets others see (A is Public, B is Private). Never an id,
  // a bio, the privacy setting or a single engagement; never signed out.
  {
    const board = await call('/rest/v1/rpc/leaderboard', { method: 'POST', token: b.token, body: {} });
    const rows = Array.isArray(board.json) ? board.json : [];
    const allowed = ['you', 'avatar', 'display_name', 'granular', 'globular', 'tasks', 'member_id'];
    const extra = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !allowed.includes(k));
    const accounts = await admin('/auth/v1/admin/users?per_page=1000');
    const userCount = Array.isArray(accounts.json?.users) ? accounts.json.users.length : null;
    check('the leaderboard has one row per member and only totals and what a profile may show: no bio, privacy setting or engagement',
      board.status === 200 && rows.length > 0 && rows.length === userCount && extra.length === 0,
      `HTTP ${board.status}, ${rows.length} row(s) for ${userCount} member(s), extra fields ${JSON.stringify(extra)}`);

    const granularA = Number((await admin(`/rest/v1/engagement_totals?member_id=eq.${a.id}&select=points`)).json?.[0]?.points ?? 0);
    const doneA = (await admin(`/rest/v1/tasks?owner_id=eq.${a.id}&status=eq.done&select=points`)).json ?? [];
    const rowsA = rows.filter((r) => r.display_name === 'A' && r.avatar === 'sun');
    const rowA = rowsA[0];
    check('the leaderboard shows a Public member\'s name and avatar, with Granular, Globular and Tasks matching their engagements and finished tasks',
      rowsA.length === 1 && rowA.you === false && Number(rowA.granular) === granularA
        && Number(rowA.globular) === doneA.reduce((s, t) => s + t.points, 0) && Number(rowA.tasks) === doneA.length,
      `A's row ${JSON.stringify(rowsA)}, expected granular ${granularA}, finished ${JSON.stringify(doneA)}`);

    const own = rows.filter((r) => r.you === true);
    const granularB = Number((await admin(`/rest/v1/engagement_totals?member_id=eq.${b.id}&select=points`)).json?.[0]?.points ?? 0);
    check('the leaderboard marks the caller\'s own row, and a Private member shows neither avatar nor name, even to themselves',
      own.length === 1 && own[0].avatar === null && own[0].display_name === null && Number(own[0].granular) === granularB && !rows.some((r) => r.display_name === 'B'),
      `own row(s) ${JSON.stringify(own)}, expected granular ${granularB}`);

    // WC-238: the link to a profile page. Only a Public member with a name
    // carries their id; an Anonymous or Private row never does.
    const withId = rows.filter((r) => 'member_id' in r);
    check('the leaderboard carries a member id only on a Public named row, as its profile link; never on an Anonymous or Private row',
      rowA?.member_id === a.id && !('member_id' in (own[0] ?? {}))
        && withId.every((r) => typeof r.display_name === 'string' && r.display_name.trim() !== '' && r.avatar !== null)
        && !rows.some((r) => r.member_id === b.id || r.member_id === outsider.id),
      `rows with an id ${JSON.stringify(withId)}, own row ${JSON.stringify(own)}`);

    const boardAnon = await call('/rest/v1/rpc/leaderboard', { method: 'POST', body: {} });
    check('a signed-out visitor cannot read the leaderboard', boardAnon.status >= 400, `HTTP ${boardAnon.status} ${JSON.stringify(boardAnon.json)}`);
  }

  // member_profile(member) (WC-238): one member's profile as another may see
  // it. Public (A): avatar, name and bio. Anonymous (the chat outsider never
  // saved one): the avatar alone. Private (B), even to B, and an unknown id:
  // null, alike. Never the privacy setting; never signed out.
  {
    const profileOf = (who, member) => call('/rest/v1/rpc/member_profile', { method: 'POST', token: who?.token, body: { member } });
    const keysOk = (j) => j !== null && typeof j === 'object' && Object.keys(j).every((k) => ['avatar', 'display_name', 'bio'].includes(k));
    const pubA = await profileOf(b, a.id);
    check('a member sees a Public member\'s avatar, name and bio, and nothing else (no privacy setting, no id)',
      pubA.status === 200 && keysOk(pubA.json) && pubA.json.avatar === 'sun' && pubA.json.display_name === 'A' && pubA.json.bio === 'A’s bio',
      `HTTP ${pubA.status} ${JSON.stringify(pubA.json)}`);
    const anonO = await profileOf(a, outsider.id);
    check('a member sees an Anonymous member\'s avatar alone, no name or bio',
      anonO.status === 200 && keysOk(anonO.json) && anonO.json.avatar === 'wave' && anonO.json.display_name == null && anonO.json.bio == null,
      `HTTP ${anonO.status} ${JSON.stringify(anonO.json)}`);
    const privB = await profileOf(a, b.id);
    const privSelf = await profileOf(b, b.id);
    const nobody = await profileOf(a, '00000000-0000-4000-8000-000000000000');
    check('a Private member\'s profile and an unknown id both come back empty, the same, even to the member themselves',
      [privB, privSelf, nobody].every((r) => r.status === 200 && r.json === null),
      `private ${privB.status} ${JSON.stringify(privB.json)}, self ${privSelf.status} ${JSON.stringify(privSelf.json)}, unknown ${nobody.status} ${JSON.stringify(nobody.json)}`);
    const profAnon = await profileOf(null, a.id);
    check('a signed-out visitor cannot read a member\'s profile', profAnon.status >= 400, `HTTP ${profAnon.status} ${JSON.stringify(profAnon.json)}`);
  }

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

  // Messages, chat messages, started chats, added forum topics, added forum tags, made proposals, changed proposals, deleted proposals, Home box changes, stars, added token sizes, changed token sizes, deleted token sizes, and made and published pages were checked above, so this reads every other kind.
  const ledgerA = await call(`/rest/v1/engagements?kind=not.in.(${MESSAGE_KIND},${CHAT_KIND},started_a_chat,added_a_forum_topic,added_a_forum_tag,made_a_proposal,changed_a_proposal,deleted_a_proposal,changed_a_home_box,starred_a_message,${TOKEN_SIZE_KIND},${TOKEN_CHANGE_KIND},${TOKEN_DELETE_KIND},${PAGE_KINDS.join(',')})&select=member_id,kind,points,tool,task_id&order=created_at`, { token: a.token });
  const kindsA = Array.isArray(ledgerA.json) ? ledgerA.json.map((e) => e.kind) : ledgerA.json;
  console.log(`\nA's engagements, oldest first: ${JSON.stringify(kindsA)}`);
  const expected = [
    'joined_wavecenter', 'made_task', 'changed_task', 'finished_task', 'switched_agents', 'changed_profile', 'approved_a_proposed_task', 'changed_a_member_s_role', 'made_a_team',
    'added_a_member_to_a_team', 'added_a_member_to_a_team', 'changed_a_member_s_role', 'changed_a_member_s_role', 'attached_file', 'removed_file',
    'posted_a_comment', 'edited_a_comment', 'deleted_a_comment', 'posted_a_comment', 'attached_file', 'removed_file', 'deleted_a_comment',
    'made_task', 'posted_a_comment', 'attached_file', 'deleted_task',
    'made_task', 'made_task', 'posted_a_comment', 'deleted_task',
  ];
  check('every change A made was recorded and scored, once each, in order', JSON.stringify(kindsA) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}`);
  check('every one of A’s engagements is credited to A and names its tool', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.member_id === a.id && e.tool),
    JSON.stringify(ledgerA.json));
  check('finishing a task is worth 5 and the rest 1, from the rules', Array.isArray(ledgerA.json) && ledgerA.json.every((e) => e.points === (e.kind === 'finished_task' ? 5 : 1)),
    JSON.stringify(ledgerA.json?.map?.((e) => [e.kind, e.points])));
  const deleted = Array.isArray(ledgerA.json) ? ledgerA.json.findLast((e) => e.kind === 'deleted_task') : null;
  check('a delete names the tool that deleted, and its task', deleted?.tool === 'rls-check-deleter' && deleted?.task_id === parent.id, JSON.stringify(deleted));

  const commentDeletes = Array.isArray(ledgerA.json) ? ledgerA.json.filter((e) => e.kind === 'deleted_a_comment') : [];
  check('deleting a comment on its own earns its writer one engagement, naming the task and the tool; a comment that goes with its task earns none',
    commentDeletes.length === 2 && commentDeletes.every((e) => e.task_id === insA.id && e.tool === TOOL), JSON.stringify(commentDeletes));

  const pagePointsA = ((await admin(`/rest/v1/engagements?member_id=eq.${a.id}&kind=in.(${PAGE_KINDS.join(',')})&select=points`)).json ?? []).reduce((sum, e) => sum + e.points, 0);
  const totalA = await call(`/rest/v1/engagement_totals?member_id=eq.${a.id}&select=points`, { token: a.token });
  check('A’s points total adds up A’s engagements', totalA.json?.[0]?.points === 34 + pagePointsA + aScored.length * messagePoints + chatA.length * chatRule?.points + startedChatPointsA + forumTopicPointsA + forumTagPointsA + madeProposalPointsA + changedProposalPointsA + deletedProposalPointsA + homeBoxPointsA + starredPointsA + tokenSizePointsA + tokenChangePointsA + tokenDeletePointsA, `total ${JSON.stringify(totalA.json)}`);

  // The first anti-farming step: a task earns "Finished a task" once, and a
  // save that changes nothing records nothing (task, profile, agents switch).
  const loop = await createTask(a.store, { title: 'A finishes this twice' }, TOOL, 'admin');
  await updateTask(a.store, loop.id, { status: 'done' }, TOOL);
  await updateTask(a.store, loop.id, { status: 'todo' }, TOOL);
  await updateTask(a.store, loop.id, { status: 'done' }, TOOL);
  await updateTask(a.store, loop.id, { title: 'A finishes this twice' }, 'rls-check-other-tool');
  const loopKinds = (await call(`/rest/v1/engagements?task_id=eq.${loop.id}&select=kind&order=created_at`, { token: a.token })).json?.map?.((e) => e.kind);
  check('finishing a task again after reopening it is a change, not a second finish; saving it unchanged records nothing',
    JSON.stringify(loopKinds) === JSON.stringify(['made_task', 'finished_task', 'changed_task', 'changed_task']), JSON.stringify(loopKinds));
  await updateTask(a.store, loop.id, { title: 'A renamed this' }, TOOL);
  const renamedKinds = (await call(`/rest/v1/engagements?task_id=eq.${loop.id}&select=kind&order=created_at`, { token: a.token })).json?.map?.((e) => e.kind);
  check('a real change to a task still earns "Changed a task"', renamedKinds?.length === 5 && renamedKinds[4] === 'changed_task', JSON.stringify(renamedKinds));
  const settingsBefore = (await call(`/rest/v1/engagements?kind=in.(changed_profile,switched_agents)&select=kind`, { token: a.token })).json?.length;
  await saveProfile(profileStore(a), { displayName: 'A', avatar: 'sun', bio: 'A’s bio', visibility: 'public' }, 'rls-check-other-tool');
  await setAgentsOn(settingsStore(a), true, TOOL);
  const settingsAfter = (await call(`/rest/v1/engagements?kind=in.(changed_profile,switched_agents)&select=kind`, { token: a.token })).json?.length;
  check('saving a profile unchanged, or the agents switch at the setting it had, records nothing', typeof settingsBefore === 'number' && settingsAfter === settingsBefore,
    `before ${settingsBefore}, after ${settingsAfter}`);

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

  // Listed-only actions (an admin's, or 20261102120000_scoring_actions_sweep.sql)
  // sit beside the wired kinds, so this asks that every wired kind is there.
  const rulesA = await call('/rest/v1/game_scoring_rules?select=kind,points', { token: a.token });
  const ruleKinds = Array.isArray(rulesA.json) ? rulesA.json.map((r) => r.kind) : [];
  check('a member can read the scoring rules, every kind among them, profiles and voting too', rulesA.status === 200 && ENGAGEMENT_KINDS.every((k) => ruleKinds.includes(k)), `HTTP ${rulesA.status} ${JSON.stringify(rulesA.json)}`);
  const anonEng = await call('/rest/v1/engagements?select=kind');
  const anonRules = await call('/rest/v1/game_scoring_rules?select=kind');
  check('a signed-out visitor sees no engagements and no rules', [anonEng, anonRules].every((r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0)), `HTTP ${anonEng.status} / ${anonRules.status}`);

  // Game management (20261031140000_game_scoring_admin.sql): only a role with
  // game.edit (admin; A is one, B a viewer) changes a rule or adds an action,
  // only through update_scoring_rule / add_scoring_rule; a change counts from
  // the next engagement; what was earned keeps its points. Whatever this
  // changes is put back below, so the rules end as they started.
  const ruleRow = async (kind) => (await admin(`/rest/v1/game_scoring_rules?kind=eq.${kind}&select=kind,name,description,criteria,points,position,tool,changed_by,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
  const original = await ruleRow('made_task');
  const ruleChanges = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.changed_a_scoring_rule&select=points,tool,task_id`)).json;
  const addedName = `RLS check ${[...randomBytes(6)].map((n) => String.fromCharCode(97 + (n % 26))).join('')}`;
  const addedKind = addedName.toLowerCase().replace(/[^a-z]+/g, '_');
  const serviceKind = `${addedKind}_service`;
  const ruleAdds = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.added_a_scoring_action&select=points,tool,task_id`)).json;
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

    check('a refused rule change scores nothing', (await ruleChanges(a))?.length === 0 && (await ruleChanges(b))?.length === 0, JSON.stringify(await ruleChanges(a)));
    const madeBefore = (await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_task&select=points`, { token: a.token })).json ?? [];
    const changed = await changeScoringRule(scoringStore(a), { role: 'admin' }, { ...original, points: original.points + 2 }, TOOL);
    await changeScoringRule(scoringStore(a), { role: 'admin' }, { ...original, points: original.points + 2 }, TOOL);
    const scoredChange = await ruleChanges(a);
    check('changing a scoring rule scores 1 for the admin who changed it, naming the tool; saving no change scores nothing',
      scoredChange?.length === 1 && scoredChange.every((e) => e.points === 1 && e.tool === TOOL && e.task_id === null), JSON.stringify(scoredChange));
    const stored = await ruleRow('made_task');
    check('an admin changes a rule through core, and the database records who and with which tool',
      changed.after.points === original.points + 2 && stored?.points === original.points + 2 && stored?.tool === TOOL && stored?.changed_by === a.id, JSON.stringify(stored));
    await createTask(a.store, { title: 'Worth more now' }, TOOL);
    const madeAfter = (await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.made_task&select=points&order=created_at`, { token: a.token })).json ?? [];
    check('the next engagement earns the new value; earlier ones keep theirs',
      madeAfter.length === madeBefore.length + 1 && madeAfter.at(-1)?.points === original.points + 2 && madeAfter.slice(0, -1).every((e) => e.points === original.points),
      JSON.stringify(madeAfter));

    check('a refused new action scores nothing', (await ruleAdds(a))?.length === 0 && (await ruleAdds(b))?.length === 0, JSON.stringify(await ruleAdds(b)));
    const added = await addScoringRule(scoringStore(a), { role: 'admin' }, { name: addedName, points: 2 }, TOOL);
    const scoredAdd = await ruleAdds(a);
    check('adding a scoring action scores 1 for the admin who added it, naming the tool',
      scoredAdd?.length === 1 && scoredAdd.every((e) => e.points === 1 && e.tool === TOOL && e.task_id === null), JSON.stringify(scoredAdd));
    const listed = (await call('/rest/v1/game_scoring_rules?select=kind,position&order=position', { token: b.token })).json ?? [];
    check('an admin adds a new action through core; every member sees it, last in the list',
      added.kind === addedKind && listed.at(-1)?.kind === addedKind && listed.at(-1)?.position === listed.length, JSON.stringify(listed.slice(-2)));
    const again = await call('/rest/v1/rpc/add_scoring_rule', { method: 'POST', token: a.token, body: addBody });
    const badKind = await call('/rest/v1/rpc/add_scoring_rule', { method: 'POST', token: a.token, body: { ...addBody, new_kind: 'Bad-Kind1' } });
    check('the same action cannot be added twice, and a kind must be a to z and _', again.status >= 400 && badKind.status >= 400, `HTTP ${again.status} / ${badKind.status}`);
    const earned = (await call(`/rest/v1/engagements?kind=eq.${addedKind}&select=id`, { token: a.token })).json ?? [];
    check('a new action earns nothing until it is wired in', Array.isArray(earned) && earned.length === 0, JSON.stringify(earned));
    check('a duplicate or bad-kind add scores nothing more', (await ruleAdds(a))?.length === 1, JSON.stringify(await ruleAdds(a)));
    const serviceAdd = await admin('/rest/v1/game_scoring_rules', { method: 'POST', body: { kind: serviceKind, name: `${addedName} service`, points: 1, position: 999, changed_by: a.id } });
    check('a rule written with the service key, as a migration would, is saved and scores nobody',
      serviceAdd.status < 300 && (await ruleAdds(a))?.length === 1, `HTTP ${serviceAdd.status} ${JSON.stringify(await ruleAdds(a))}`);

    // Factor scores and the Admin page's batch (20261102180000_scoring_factors.sql).
    const factorBody = (extra = {}) => ({ rule_kind: addedKind, new_effort: 1, new_value: 2, new_rarity: 0, new_farm_risk: 2, tool: TOOL, ...extra });
    const factorsByB = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: b.token, body: factorBody() });
    const factorsByAnon = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', body: factorBody() });
    const outOfRange = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: a.token, body: factorBody({ new_rarity: 3 }) });
    const halfScored = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: a.token, body: factorBody({ new_value: null }) });
    check('a non-admin cannot set an action\'s factors; out-of-range or half-scored factors are refused even for an admin',
      [factorsByB, factorsByAnon, outOfRange, halfScored].every((r) => r.status >= 400), `HTTP ${factorsByB.status} / ${factorsByAnon.status} / ${outOfRange.status} / ${halfScored.status}`);
    const scored = await changeScoringFactors(scoringStore(a), { role: 'admin' }, { kind: addedKind, factors: { effort: 1, value: 2, rarity: 0, farmRisk: 2 } }, TOOL);
    check('an admin sets an action\'s factors through core, and its points do not change', scored.factors?.value === 2 && scored.points === 2, JSON.stringify(scored));
    // Scoring an action's factors earns its point
    // (20261123210000_score_scored_an_action_s_factors.sql, WC-197): a saved
    // change to any of an action's four factors is scored once for the
    // signed-in admin who saved it, naming the save's tool; a refused save,
    // a save that changes no factor and a service-key write score nothing;
    // nobody can write the engagement themselves. Checked against counts
    // taken here, so it leaves A's list and total above as they were.
    {
      const FACTORS_KIND = 'scored_an_action_s_factors';
      const factorScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${FACTORS_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const factorsRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${FACTORS_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
      const [fa, fb] = [await factorScores(a), await factorScores(b)];
      check('setting an action’s factors above recorded exactly one engagement for the admin who saved them, worth what the rule says, naming the tool; the refused saves recorded none',
        fa.length === 1 && fa[0].points === factorsRule?.points && fa[0].tool === TOOL && fa[0].task_id === null && fb.length === 0,
        `A ${JSON.stringify(fa)}, B ${JSON.stringify(fb)}, rule ${factorsRule?.points}`);
      const same = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: a.token, body: factorBody() });
      const fa2 = await factorScores(a);
      check('saving the same four factors again saves and records nothing', same.status === 200 && fa2.length === 1, `HTTP ${same.status}, A ${JSON.stringify(fa2)}`);
      const otherTool = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: a.token, body: factorBody({ new_farm_risk: 3, tool: 'rls-check-factors-tool' }) });
      const putBack = await call('/rest/v1/rpc/set_scoring_factors', { method: 'POST', token: a.token, body: factorBody() });
      const fa3 = await factorScores(a);
      check('each saved change of factors records one more engagement for the admin, naming the tool it sent',
        otherTool.status === 200 && putBack.status === 200 && fa3.length === 3 && fa3[1].tool === 'rls-check-factors-tool' && fa3[2].tool === TOOL,
        `HTTP ${otherTool.status} / ${putBack.status}, A ${JSON.stringify(fa3)}`);
      const svc = await admin(`/rest/v1/game_scoring_rules?kind=eq.${addedKind}`, { method: 'PATCH', prefer: 'return=representation', body: { farm_risk: 1, changed_by: a.id } });
      const fa4 = await factorScores(a);
      check('factors saved with the service key (no signed-in member) are saved and score nobody',
        svc.status < 300 && svc.json?.[0]?.farm_risk === 1 && fa4.length === 3, `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A ${fa4.length}`);
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: FACTORS_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: FACTORS_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/game_scoring_rules_score_factors', { method: 'POST', token: b.token, body: {} });
      const fb2 = await factorScores(b);
      check('a member cannot forge a "Scored an action’s factors" engagement: not in the ledger, not through the ledger’s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && fb2.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, trigger HTTP ${forgeTrigger.status}, B now ${fb2.length}`);
      check('"Scored an action’s factors" is active at 1 point with its four factors and a reason for each',
        factorsRule?.name === 'Scored an action\'s factors' && factorsRule.points === 1 && factorsRule.effort === 1 && factorsRule.value === 2 && factorsRule.rarity === 1 && factorsRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof factorsRule[k] === 'string' && factorsRule[k].length > 0),
        JSON.stringify(factorsRule));
      const restoreFactors = await admin(`/rest/v1/game_scoring_rules?kind=eq.${addedKind}`, { method: 'PATCH', body: { farm_risk: 2 } });
      if (restoreFactors.status >= 300) throw new Error(`could not put ${addedKind}'s factors back: HTTP ${restoreFactors.status}`);
    }
    const proposals = await recalculateGranularPoints(scoringStore(a), { role: 'admin' });
    const madeProposal = proposals.find((p) => p.kind === 'made_task');
    check('the batch reads the factors the migration filled and proposes by formula', madeProposal?.proposed === 6 && proposals.find((p) => p.kind === addedKind)?.proposed === 6,
      JSON.stringify(proposals.slice(0, 2)));
    let refusedBatch = '';
    try {
      await applyGranularPoints(scoringStore(b), { role: 'viewer' }, [{ kind: addedKind, now: 2, proposed: 6 }], TOOL);
    } catch (err) {
      refusedBatch = err.message;
    }
    check('a non-admin cannot put the batch live', /Only an admin/.test(refusedBatch), refusedBatch || 'it went through');
    const live = await applyGranularPoints(scoringStore(a), { role: 'admin' }, [{ kind: addedKind, now: 2, proposed: 6 }], TOOL);
    check('an admin puts the batch live, and only the accepted row changes', live.saved.length === 1 && live.failed.length === 0 && (await ruleRow(addedKind))?.points === 6 && (await ruleRow('made_task'))?.points === original.points + 2,
      JSON.stringify(live));
    const batchChanges = await ruleChanges(a);
    check('putting the batch live scores 1 "changed a scoring rule" per saved row, for the admin who put it live',
      batchChanges?.length === 2 && batchChanges.every((e) => e.points === 1 && e.tool === TOOL), JSON.stringify(batchChanges));

    // Factor reasons written on Game > Manage (20261103140000_edit_factor_reasons.sql).
    const reasonBody = (extra = {}) => ({ rule_kind: 'made_task', new_effort_reason: null, new_value_reason: null, new_rarity_reason: null, new_farm_risk_reason: 'Mine now.', tool: TOOL, ...extra });
    const reasonsByB = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', token: b.token, body: reasonBody() });
    const reasonsByAnon = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', body: reasonBody() });
    const tooLong = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', token: a.token, body: reasonBody({ new_farm_risk_reason: 'x'.repeat(301) }) });
    check('a non-admin cannot change a factor reason; one over 300 characters is refused even for an admin',
      [reasonsByB, reasonsByAnon, tooLong].every((r) => r.status >= 400) && (await ruleRow('made_task'))?.farm_risk_reason === original.farm_risk_reason,
      `HTTP ${reasonsByB.status} / ${reasonsByAnon.status} / ${tooLong.status}`);
    const changesBeforeReason = (await ruleChanges(a))?.length;
    const reasoned = await changeFactorReasons(scoringStore(a), { role: 'admin' }, { kind: 'made_task', reasons: { farmRisk: '  Make-and-delete loops.  ' } }, TOOL);
    const reasonedRow = await ruleRow('made_task');
    check('an admin changes one factor reason through core; the others and the points stay, and nobody is scored',
      reasoned.reasons?.farmRisk === 'Make-and-delete loops.' && reasonedRow?.farm_risk_reason === 'Make-and-delete loops.' && reasonedRow?.effort_reason === original.effort_reason
        && reasonedRow?.points === original.points + 2 && (await ruleChanges(a))?.length === changesBeforeReason,
      JSON.stringify(reasonedRow));
    // Giving a reason for a factor earns its point
    // (20261123220000_score_gave_a_reason_for_a_factor.sql, WC-198): a saved
    // change to any of an action's four factor reasons is scored once for the
    // signed-in admin who saved it, naming the save's tool; a refused save,
    // a save that changes no reason and a service-key write score nothing;
    // nobody can write the engagement themselves. Checked against counts
    // taken here, so it leaves A's list and total above as they were.
    {
      const REASON_KIND = 'gave_a_reason_for_a_factor';
      const reasonScores = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.${REASON_KIND}&select=points,tool,task_id&order=created_at`)).json ?? [];
      const reasonRule = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${REASON_KIND}&select=name,points,effort,value,rarity,farm_risk,effort_reason,value_reason,rarity_reason,farm_risk_reason`)).json?.[0];
      const [ra, rb] = [await reasonScores(a), await reasonScores(b)];
      check('changing a factor reason above recorded exactly one engagement for the admin who saved it, worth what the rule says, naming the tool; the refused saves recorded none',
        ra.length === 1 && ra[0].points === reasonRule?.points && ra[0].tool === TOOL && ra[0].task_id === null && rb.length === 0,
        `A ${JSON.stringify(ra)}, B ${JSON.stringify(rb)}, rule ${reasonRule?.points}`);
      const now = await ruleRow('made_task');
      const sameBody = { rule_kind: 'made_task', new_effort_reason: now?.effort_reason, new_value_reason: now?.value_reason, new_rarity_reason: now?.rarity_reason, new_farm_risk_reason: now?.farm_risk_reason, tool: TOOL };
      const same = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', token: a.token, body: { ...sameBody, new_farm_risk_reason: `  ${now?.farm_risk_reason}  ` } });
      const ra2 = await reasonScores(a);
      check('saving the same four reasons again saves and records nothing', same.status === 200 && ra2.length === 1, `HTTP ${same.status}, A ${JSON.stringify(ra2)}`);
      const otherTool = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', token: a.token, body: { ...sameBody, new_effort_reason: 'Typing a title.', tool: 'rls-check-reason-tool' } });
      const putBack = await call('/rest/v1/rpc/set_scoring_factor_reasons', { method: 'POST', token: a.token, body: sameBody });
      const ra3 = await reasonScores(a);
      check('each saved change of reasons records one more engagement for the admin, naming the tool it sent',
        otherTool.status === 200 && putBack.status === 200 && ra3.length === 3 && ra3[1].tool === 'rls-check-reason-tool' && ra3[2].tool === TOOL,
        `HTTP ${otherTool.status} / ${putBack.status}, A ${JSON.stringify(ra3)}`);
      const svc = await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', prefer: 'return=representation', body: { effort_reason: 'Set by the service key.', changed_by: a.id } });
      const ra4 = await reasonScores(a);
      check('a reason saved with the service key (no signed-in member) is saved and scores nobody',
        svc.status < 300 && svc.json?.[0]?.effort_reason === 'Set by the service key.' && ra4.length === 3, `HTTP ${svc.status} ${JSON.stringify(svc.json)}, A ${ra4.length}`);
      const forgeLedger = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: REASON_KIND, points: 1, tool: TOOL } });
      const forgeRecord = await call('/rest/v1/rpc/record_engagement', { method: 'POST', token: b.token, body: { p_member: b.id, p_kind: REASON_KIND, p_tool: TOOL, p_task: null } });
      const forgeTrigger = await call('/rest/v1/rpc/game_scoring_rules_score_reasons', { method: 'POST', token: b.token, body: {} });
      const rb2 = await reasonScores(b);
      check('a member cannot forge a "Gave a reason for a factor" engagement: not in the ledger, not through the ledger’s function, not through the trigger',
        forgeLedger.status >= 400 && forgeRecord.status >= 400 && forgeTrigger.status >= 400 && rb2.length === 0,
        `ledger HTTP ${forgeLedger.status}, record_engagement HTTP ${forgeRecord.status}, trigger HTTP ${forgeTrigger.status}, B now ${rb2.length}`);
      check('"Gave a reason for a factor" is active at 1 point with its four factors and a reason for each',
        reasonRule?.name === 'Gave a reason for a factor' && reasonRule.points === 1 && reasonRule.effort === 1 && reasonRule.value === 2 && reasonRule.rarity === 1 && reasonRule.farm_risk === 3
          && ['effort_reason', 'value_reason', 'rarity_reason', 'farm_risk_reason'].every((k) => typeof reasonRule[k] === 'string' && reasonRule[k].length > 0),
        JSON.stringify(reasonRule));
    }
  } finally {
    const changesBefore = (await ruleChanges(a))?.length;
    const { kind, position, tool, changed_by, ...wording } = original ?? {};
    const restored = await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', body: { ...wording, tool, changed_by } });
    const removed = await admin(`/rest/v1/game_scoring_rules?kind=in.(${addedKind},${serviceKind})`, { method: 'DELETE' });
    check('putting a rule back with the service key scores nobody', (await ruleChanges(a))?.length === changesBefore, JSON.stringify(await ruleChanges(a)));
    if (restored.status >= 300 || removed.status >= 300) {
      failures += 1;
      console.error(`could not put the scoring rules back (HTTP ${restored.status} / ${removed.status}) — set made_task to ${original?.points} and delete ${addedKind} and ${serviceKind} by hand`);
    }
  }

  // task_votes: any member votes on any task, only ever through their own
  // vote. The database makes the priority votes' average the task's
  // priority, and the other members' points votes its others' score: its
  // points are the final score, the average of the owner's score, the AI
  // score and the others' score (20261104140000_final_task_score.sql). The
  // owner's score (20261104130000_task_owner_score.sql) is B's own 5
  // throughout: votes never overwrite it.
  const taskOf = async (id) => (await admin(`/rest/v1/tasks?id=eq.${id}&select=points,priority,owner_points`)).json?.[0];
  check('a new task’s owner’s score is the points its owner made it with', (await taskOf(taskB))?.owner_points === 5, JSON.stringify(await taskOf(taskB)));
  await castVote(voteStore(a), taskB, { points: 8, priority: 'high' }, TOOL);
  let shown = await taskOf(taskB);
  check('A can vote on B’s task: its priority is the vote, its points the average of B’s 5 and A’s 8, so 7', shown?.points === 7 && shown?.priority === 'high', JSON.stringify(shown));
  await castVote(voteStore(b), taskB, { points: 4, priority: 'low' }, TOOL);
  shown = await taskOf(taskB);
  check('the owner’s own points vote is not an other member’s score (still 7), but High and Low make Normal', shown?.points === 7 && shown?.priority === 'normal', JSON.stringify(shown));
  check('the votes leave B’s owner’s score at 5', shown?.owner_points === 5, JSON.stringify(shown));
  // Run as A, an admin who owns insA, not B: B is a viewer by now, so the
  // row-level rules would refuse B's write before the tasks_owner_points
  // trigger was reached, and this check would pass even if the trigger broke.
  // The write must reach the row (one row back) and still leave the score.
  const scoreBefore = (await taskOf(insA.id))?.owner_points;
  const forgeOwnerScore = await call(`/rest/v1/tasks?id=eq.${insA.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { owner_points: 99, tool: TOOL } });
  check('even its owner cannot write the owner’s score straight to the column',
    forgeOwnerScore.status === 200 && forgeOwnerScore.json?.length === 1 && scoreBefore !== 99 && (await taskOf(insA.id))?.owner_points === scoreBefore,
    `HTTP ${forgeOwnerScore.status} ${JSON.stringify(forgeOwnerScore.json)} before ${scoreBefore} after ${JSON.stringify(await taskOf(insA.id))}`);

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
  check('B’s task is still at its final score afterwards', shown?.points === 7 && shown?.priority === 'normal', JSON.stringify(shown));

  await castVote(voteStore(b), taskB, { points: null, priority: null }, TOOL);
  shown = await taskOf(taskB);
  check('B can withdraw B’s own vote, and the priority is A’s alone again', shown?.points === 7 && shown?.priority === 'high', JSON.stringify(shown));
  check('withdrawing a vote leaves B’s owner’s score at 5', shown?.owner_points === 5, JSON.stringify(shown));

  // The owner's own change moves the owner's score, and an owner's 0 is "not set".
  const zeroTask = await createTask(a.store, { title: 'A’s unscored task', points: 0 }, TOOL);
  check('a task made at 0 points has no owner’s score yet', (await taskOf(zeroTask.id))?.owner_points === null, JSON.stringify(await taskOf(zeroTask.id)));
  const setByOwner = await setPoints(a.store, zeroTask.id, 10, TOOL);
  check('the owner setting 10 points through core makes the owner’s score 10, in core and the database alike',
    setByOwner.task.ownerPoints === 10 && (await taskOf(zeroTask.id))?.owner_points === 10, JSON.stringify(await taskOf(zeroTask.id)));
  const clearedByOwner = await setPoints(a.store, zeroTask.id, 0, TOOL);
  check('the owner setting 0 makes the owner’s score "not set" again', clearedByOwner.task.ownerPoints === null && (await taskOf(zeroTask.id))?.owner_points === null,
    JSON.stringify(await taskOf(zeroTask.id)));
  await deleteTask(a.store, zeroTask.id, TOOL);

  // AI task ratings (20261104120000_ai_task_factor_ratings.sql): one pass is
  // a row of ai_task_ratings with a row of ai_task_model_ratings per model,
  // saved whole by record_ai_task_rating (the server only). Every member
  // reads them; nobody adds, changes or deletes a row straight at the
  // tables, not even the service key. The save refuses a pass off the 1-to-5
  // scale or without its model, instruction version, fingerprint or reasons,
  // and works out the averages and the AI score itself.
  const ratingReasons = {
    scope_reason: 'A new feature on one screen.', difficulty_reason: 'Needs real thought.',
    relevance_reason: 'Adds something members use.', demand_reason: 'Members are held back without it.',
  };
  const opusPart = { model: 'claude-opus-5-5', scope: 3, difficulty: 3, relevance: 3, demand: 4, ...ratingReasons };
  const sonnetPart = { model: 'claude-sonnet-5-5', scope: 3, difficulty: 2, relevance: 4, demand: 4, ...ratingReasons };
  const ratingPass = (over = {}, models = [opusPart, sonnetPart]) => ({
    task: taskB, instruction_version: 'rls-check', fingerprint: 'sha256:rls-check', tool: TOOL, models, ...over,
  });
  const recordRating = (body, key = SERVICE, token) => call('/rest/v1/rpc/record_ai_task_rating', { method: 'POST', key, token, body });
  const ratedByServer = await recordRating(ratingPass());
  const ratingId = ratedByServer.json;
  check('the server saves a whole AI rating pass with the service key', ratedByServer.status === 200 && typeof ratingId === 'string', `HTTP ${ratedByServer.status} ${JSON.stringify(ratedByServer.json)}`);
  const ratingSeen = await call(`/rest/v1/ai_task_ratings?task_id=eq.${taskB}&select=id,scope,difficulty,relevance,demand,ai_score,fingerprint,ai_task_model_ratings(model,difficulty,scope_reason)`, { token: a.token });
  const seenPass = ratingSeen.json?.[0];
  // Averages 3, 2.5, 3.5, 4: 3 × 2.5 × (3.5 + 4) ÷ 5 = 11.25, so 11.
  check('a member reads the AI rating pass of another member’s task: the averages, the AI score, and each model’s part',
    ratingSeen.status === 200 && seenPass?.id === ratingId && seenPass.ai_score === 11 && Number(seenPass.difficulty) === 2.5 && Number(seenPass.relevance) === 3.5
      && seenPass.ai_task_model_ratings?.length === 2 && seenPass.ai_task_model_ratings.every((m) => m.scope_reason === ratingReasons.scope_reason),
    `HTTP ${ratingSeen.status} ${JSON.stringify(ratingSeen.json)}`);
  shown = await taskOf(taskB);
  check('an AI rating sets the task’s points to the final score: owner 5, AI 11, others 8 make 8, and leaves the owner’s score alone',
    shown?.points === 8 && shown?.owner_points === 5, JSON.stringify(shown));
  const secondPass = await recordRating(ratingPass({ fingerprint: 'sha256:rls-check-2' }));
  const newest = await call(`/rest/v1/ai_task_ratings?task_id=eq.${taskB}&select=id&order=created_at.desc,seq.desc&limit=1`, { token: a.token });
  check('a second pass adds a record, and newest first puts it on top', secondPass.status === 200 && newest.json?.[0]?.id === secondPass.json, `HTTP ${secondPass.status}, newest ${JSON.stringify(newest.json)}`);

  const ratingByMember = await recordRating(ratingPass(), ANON, b.token);
  const straightIn = await call('/rest/v1/ai_task_ratings', { method: 'POST', token: b.token, body: { task_id: taskB, scope: 1, difficulty: 1, relevance: 1, demand: 1, ai_score: 1, instruction_version: 'x', fingerprint: 'x', tool: TOOL } });
  const ratingBumped = await call(`/rest/v1/ai_task_ratings?id=eq.${ratingId}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { fingerprint: 'Hijacked' } });
  const partBumped = await call(`/rest/v1/ai_task_model_ratings?rating_id=eq.${ratingId}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { scope_reason: 'Hijacked' } });
  const ratingWiped = await call(`/rest/v1/ai_task_ratings?id=eq.${ratingId}`, { method: 'DELETE', token: b.token, prefer: 'return=representation' });
  check('a member cannot save, add, change or delete an AI rating, even on their own task',
    ratingByMember.status >= 400 && straightIn.status >= 400 && ratingBumped.status >= 400 && partBumped.status >= 400 && ratingWiped.status >= 400,
    `save HTTP ${ratingByMember.status}, insert HTTP ${straightIn.status}, patch HTTP ${ratingBumped.status}/${partBumped.status}, delete HTTP ${ratingWiped.status}`);
  const serverBumped = await admin(`/rest/v1/ai_task_ratings?id=eq.${ratingId}`, { method: 'PATCH', body: { fingerprint: 'Hijacked' } });
  const serverPartBumped = await admin(`/rest/v1/ai_task_model_ratings?rating_id=eq.${ratingId}`, { method: 'PATCH', body: { scope_reason: 'Hijacked' } });
  const serverWiped = await admin(`/rest/v1/ai_task_ratings?id=eq.${ratingId}`, { method: 'DELETE' });
  const serverStraightIn = await admin('/rest/v1/ai_task_model_ratings', { method: 'POST', body: { rating_id: ratingId, model: 'sneaked-in', scope: 5, difficulty: 5, relevance: 5, demand: 5, ...ratingReasons } });
  const keptPass = (await admin(`/rest/v1/ai_task_ratings?id=eq.${ratingId}&select=fingerprint,ai_task_model_ratings(model,scope_reason)`)).json?.[0];
  check('even the service key cannot change, delete or add to a saved pass: the history is kept as it was',
    serverBumped.status >= 400 && serverPartBumped.status >= 400 && serverWiped.status >= 400 && serverStraightIn.status >= 400
      && keptPass?.fingerprint === 'sha256:rls-check' && keptPass.ai_task_model_ratings?.length === 2 && keptPass.ai_task_model_ratings.every((m) => m.scope_reason === ratingReasons.scope_reason),
    `patch HTTP ${serverBumped.status}/${serverPartBumped.status}, delete HTTP ${serverWiped.status}, insert HTTP ${serverStraightIn.status}, kept ${JSON.stringify(keptPass)}`);
  const anonRatings = await call('/rest/v1/ai_task_ratings?select=id');
  const anonParts = await call('/rest/v1/ai_task_model_ratings?select=id');
  check('a signed-out visitor sees no AI ratings',
    [anonRatings, anonParts].every((r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0)), `HTTP ${anonRatings.status}/${anonParts.status}`);

  const passesBefore = ((await admin(`/rest/v1/ai_task_ratings?task_id=eq.${taskB}&select=id`)).json ?? []).length;
  const badPasses = {
    'a factor of 0': ratingPass({}, [{ ...opusPart, scope: 0 }, sonnetPart]),
    'a factor of 6': ratingPass({}, [opusPart, { ...sonnetPart, demand: 6 }]),
    'a factor of 2.5': ratingPass({}, [{ ...opusPart, scope: 2.5 }]),
    'no model at all': ratingPass({}, []),
    'the same model twice': ratingPass({}, [opusPart, opusPart]),
    'no model id': ratingPass({}, [{ ...opusPart, model: null }]),
    'a blank model id': ratingPass({}, [{ ...opusPart, model: '  ' }]),
    'no instruction version': ratingPass({ instruction_version: null }),
    'no fingerprint': ratingPass({ fingerprint: null }),
    'a fingerprint of a line break and a tab': ratingPass({ fingerprint: '\n\t' }),
    'a reason of a line break and a tab': ratingPass({}, [{ ...opusPart, relevance_reason: '\n\t' }]),
    'no reason': ratingPass({}, [{ ...opusPart, demand_reason: null }]),
    'a reason over 300 characters': ratingPass({}, [{ ...opusPart, scope_reason: 'x'.repeat(301) }]),
    'a tool name over 100 characters': ratingPass({ tool: 't'.repeat(101) }),
  };
  const badResults = await Promise.all(Object.entries(badPasses).map(async ([what, body]) => [what, (await recordRating(body)).status]));
  const notRefused = badResults.filter(([, status]) => status < 400).map(([what]) => what);
  const passesAfter = ((await admin(`/rest/v1/ai_task_ratings?task_id=eq.${taskB}&select=id`)).json ?? []).length;
  check('the save refuses, even from the server, a pass off the scale, with no model or one twice, or without its model id, instruction version, fingerprint or reasons, and saves no part of it',
    notRefused.length === 0 && passesAfter === passesBefore, `not refused: ${JSON.stringify(notRefused)}, passes ${passesBefore} then ${passesAfter}`);

  // The final score on a task of A's own: the owner typing the number the
  // task already shows still sets their score; a done task's points stay
  // locked when the AI rates it again; reopening gives it its final score.
  const scored = await createTask(a.store, { title: 'A’s task the AI rates', points: 6 }, TOOL, 'admin');
  await recordRating(ratingPass({ task: scored.id, fingerprint: 'sha256:rls-final' }));
  check('owner 6 and AI 11 make 8.5, so 9 points: the same rule as core', (await taskOf(scored.id))?.points === 9, JSON.stringify(await taskOf(scored.id)));
  const sameNumber = await setPoints(a.store, scored.id, 9, TOOL);
  check('the owner typing the 9 already shown makes their score 9, and the final score 10',
    sameNumber.task.ownerPoints === 9 && sameNumber.task.points === 10 && (await taskOf(scored.id))?.owner_points === 9, JSON.stringify(await taskOf(scored.id)));
  await updateTask(a.store, scored.id, { status: 'done' }, TOOL);
  const fives = { scope: 5, difficulty: 5, relevance: 5, demand: 5 };
  await recordRating(ratingPass({ task: scored.id, fingerprint: 'sha256:rls-final-2' }, [{ ...opusPart, ...fives }]));
  await castVote(voteStore(b), scored.id, { points: 40 }, TOOL);
  check('a done task’s points stay locked when the AI rates it again and a member votes', (await taskOf(scored.id))?.points === 10, JSON.stringify(await taskOf(scored.id)));
  await updateTask(a.store, scored.id, { status: 'todo' }, TOOL);
  check('reopened, it takes its final score: owner 9, AI 50, others 40 make 33',
    (await taskOf(scored.id))?.points === 33, JSON.stringify(await taskOf(scored.id)));
  await deleteTask(a.store, scored.id, TOOL);

  // Deleting the task takes its ratings with it, despite the rows being kept.
  // A adds it: B is a viewer by now, and a viewer adds no tasks.
  const ratedTask = await call('/rest/v1/tasks', { method: 'POST', token: a.token, prefer: 'return=representation', body: { title: 'rated, then deleted' } });
  const ratedTaskId = ratedTask.json?.[0]?.id;
  const ratedPassId = (await recordRating(ratingPass({ task: ratedTaskId }))).json;
  const ratedTaskGone = await admin(`/rest/v1/tasks?id=eq.${ratedTaskId}`, { method: 'DELETE' });
  const leftPasses = (await admin(`/rest/v1/ai_task_ratings?id=eq.${ratedPassId}&select=id`)).json ?? [];
  const leftParts = (await admin(`/rest/v1/ai_task_model_ratings?rating_id=eq.${ratedPassId}&select=id`)).json ?? [];
  check('deleting a task deletes its AI rating passes and their model parts', typeof ratedPassId === 'string' && ratedTaskGone.status < 300 && leftPasses.length === 0 && leftParts.length === 0,
    `task HTTP ${ratedTask.status}, delete HTTP ${ratedTaskGone.status}, left ${leftPasses.length} pass(es), ${leftParts.length} part(s)`);

  // The AI rating lane's pass reports (20261104150000_ai_rating_passes.sql):
  // the lane adds one per pass with the service key; every member reads
  // them for the Admin page; no member adds, changes or deletes one, and not
  // even the server changes one. This check's own report is dated long ago,
  // so the Admin page never shows it as the newest, and is deleted at once.
  const testPass = { started_at: '2000-01-01T00:00:00Z', finished_at: '2000-01-01T00:01:00Z', signed_in_with: 'claude.ai (rls check)', rated: 1,
    failed: [{ task_id: taskB, title: 'rls check', reason: 'a test failure' }], waiting: 2, up_to_date: 3, tool: TOOL };
  const passSaved = await admin('/rest/v1/ai_rating_passes', { method: 'POST', prefer: 'return=representation', body: testPass });
  const passId = passSaved.json?.[0]?.id;
  check('the server saves an AI rating pass report with the service key', passSaved.status < 300 && typeof passId === 'string', `HTTP ${passSaved.status} ${JSON.stringify(passSaved.json)}`);
  const passRead = await call(`/rest/v1/ai_rating_passes?id=eq.${passId}&select=rated,failed,waiting`, { token: b.token });
  check('a member reads the pass report, failures and all', passRead.status === 200 && passRead.json?.[0]?.rated === 1 && passRead.json[0].failed?.[0]?.reason === 'a test failure',
    `HTTP ${passRead.status} ${JSON.stringify(passRead.json)}`);
  const passByMember = await call('/rest/v1/ai_rating_passes', { method: 'POST', token: b.token, body: { ...testPass, rated: 99 } });
  const passBumped = await call(`/rest/v1/ai_rating_passes?id=eq.${passId}`, { method: 'PATCH', token: b.token, prefer: 'return=representation', body: { rated: 99 } });
  const passWiped = await call(`/rest/v1/ai_rating_passes?id=eq.${passId}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
  const passServerBumped = await admin(`/rest/v1/ai_rating_passes?id=eq.${passId}`, { method: 'PATCH', body: { rated: 99 } });
  const passKept = (await admin(`/rest/v1/ai_rating_passes?id=eq.${passId}&select=rated`)).json?.[0];
  check('no member adds, changes or deletes a pass report, and not even the server changes one',
    passByMember.status >= 400 && (passBumped.status >= 400 || (passBumped.json ?? []).length === 0) && (passWiped.status >= 400 || (passWiped.json ?? []).length === 0)
      && passServerBumped.status >= 400 && passKept?.rated === 1,
    `insert HTTP ${passByMember.status}, patch HTTP ${passBumped.status}, delete HTTP ${passWiped.status}, server patch HTTP ${passServerBumped.status}, kept ${JSON.stringify(passKept)}`);
  const anonPasses = await call('/rest/v1/ai_rating_passes?select=id');
  check('a signed-out visitor sees no pass reports', anonPasses.status >= 400 || (Array.isArray(anonPasses.json) && anonPasses.json.length === 0), `HTTP ${anonPasses.status}`);
  const passBad = await admin('/rest/v1/ai_rating_passes', { method: 'POST', body: { ...testPass, rated: -1 } });
  const passBadFailed = await admin('/rest/v1/ai_rating_passes', { method: 'POST', body: { ...testPass, failed: { not: 'a list' } } });
  check('the database refuses a pass report with a negative count or failures that are not a list', passBad.status >= 400 && passBadFailed.status >= 400,
    `HTTP ${passBad.status}/${passBadFailed.status}`);
  const passGone = await admin(`/rest/v1/ai_rating_passes?id=eq.${passId}`, { method: 'DELETE' });
  if (passGone.status >= 300) {
    failures += 1;
    console.error(`could not delete the test AI rating pass report ${passId}: HTTP ${passGone.status} — delete it by hand in the Supabase dashboard`);
  }

  await castVote(voteStore(a), insA.id, { points: 50 }, TOOL);
  shown = await taskOf(insA.id);
  check('a vote on a done task is kept but its points stay locked', shown?.points === 3 && (await voteStore(a).mine(insA.id))?.points === 50, JSON.stringify(shown));

  const votedA = await call(`/rest/v1/engagements?member_id=eq.${a.id}&kind=eq.voted_on_task&select=task_id`, { token: a.token });
  const votedB = await call(`/rest/v1/engagements?member_id=eq.${b.id}&kind=eq.voted_on_task&select=task_id`, { token: b.token });
  const bChanged = await call(`/rest/v1/engagements?member_id=eq.${b.id}&task_id=eq.${taskB}&kind=eq.changed_task&select=kind`, { token: b.token });
  // B's three: a vote and its withdrawal on B's task, and the vote on A's task the AI rated.
  check('every vote is scored once, for the voter', votedA.json?.length === 2 && votedB.json?.length === 3, `A ${JSON.stringify(votedA.json)}, B ${JSON.stringify(votedB.json)}`);
  check('the votes and AI ratings landing on B’s task are not scored as B changing it', bChanged.json?.length === 0, JSON.stringify(bChanged.json));

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

  // A (an admin) owns this one: B is a viewer by now, and adds and deletes no tasks.
  const doomed = await createTask(a.store, { title: 'A’s task to delete', points: 1 }, TOOL, 'admin');
  await castVote(voteStore(a), doomed.id, { points: 3 }, TOOL);
  await castVote(voteStore(b), doomed.id, { priority: 'high' }, TOOL);
  const votesBefore = [await countOf(a, '&kind=eq.voted_on_task'), await countOf(b, '&kind=eq.voted_on_task')];
  await deleteTask(a.store, doomed.id, TOOL, memberPermissions('admin'));
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
  // With C: others 8 and 2 make 5; owner 5, AI 11, others 5 make 7. Without: 8.
  check('their vote leaves the final score with them', withC?.points === 7 && withC?.priority === 'normal' && shown?.points === 8 && shown?.priority === 'high', `with C ${JSON.stringify(withC)}, after ${JSON.stringify(shown)}`);
  check('and the owner earns nothing for it', bBeforeC === await countOf(b), `B had ${bBeforeC} engagements`);

  // Rescoring past points (20261103160000_rescore_past_points.sql): only a
  // role with game.edit (A is an admin, B a viewer) previews or rescores,
  // and only while game_settings says scoring is provisional; a rescore adds
  // correction rows and never changes one already there. Every member reads
  // the settings; nobody writes them, the rescore history or a correction
  // row through the API. A real rescore changes every member's points, so it
  // runs only on the private test database, never the live one.
  const rescoreStore = (member) => ({
    rules: async () => ((await call('/rest/v1/game_scoring_rules?select=kind,name,points,position&order=position', { token: member.token })).json ?? []),
    provisional: async () => (await call('/rest/v1/game_settings?select=scoring_provisional', { token: member.token })).json?.[0]?.scoring_provisional === true,
    // Paged the way app/lib/engagementStore.ts reads it (ordered, then
    // offset and limit, until a page is empty), one row a page so even a
    // small test ledger takes several pages.
    tallies: async () => {
      const rows = [];
      for (;;) {
        const r = await call(`/rest/v1/rpc/rescore_tallies?order=member_id.asc,kind.asc&offset=${rows.length}&limit=1`, { method: 'POST', token: member.token, body: {} });
        if (r.status >= 300) throw new Error(`rescore_tallies refused: ${r.json?.message ?? r.status}`);
        if (!r.json?.length) break;
        rows.push(...r.json);
      }
      return rows.map((t) => ({ memberId: t.member_id, memberName: t.member_name, kind: t.kind, actions: Number(t.actions), credited: Number(t.credited) }));
    },
    apply: async (kinds, tool) => {
      const r = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: member.token, body: { rescore_kinds: kinds, tool } });
      if (r.status >= 300) throw new Error(`apply_rescore refused: ${r.json?.message ?? r.status}`);
      return { rescoreId: r.json.rescore_id, rows: Number(r.json.rows), points: Number(r.json.points) };
    },
  });
  const settingsB = await call('/rest/v1/game_settings?select=scoring_provisional', { token: b.token });
  check('every member reads whether scoring is provisional', settingsB.status === 200 && typeof settingsB.json?.[0]?.scoring_provisional === 'boolean', `HTTP ${settingsB.status} ${JSON.stringify(settingsB.json)}`);
  const tallyB = await call('/rest/v1/rpc/rescore_tallies', { method: 'POST', token: b.token, body: {} });
  const applyB = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: b.token, body: { rescore_kinds: ['made_task'], tool: TOOL } });
  const applyAnon = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', body: { rescore_kinds: ['made_task'], tool: TOOL } });
  const viaCoreB = await applyRescore(rescoreStore(b), { role: 'viewer' }, ['made_task'], TOOL).then(() => '', (e) => e.message);
  // B plays a hostile client that claims to be an admin to core: the database still refuses.
  const forgedCoreB = await previewRescore(rescoreStore(b), { role: 'admin' }).then(() => '', (e) => e.message);
  check('a viewer or a signed-out visitor cannot preview or rescore, through core or straight at the database',
    tallyB.status >= 400 && applyB.status >= 400 && applyAnon.status >= 400 && /Only an admin can rescore/.test(viaCoreB) && /refused/.test(forgedCoreB),
    `tallies HTTP ${tallyB.status}, apply HTTP ${applyB.status} / signed out ${applyAnon.status}, core ${viaCoreB} / ${forgedCoreB}`);
  const flipA = await call('/rest/v1/game_settings?id=eq.true', { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { scoring_provisional: false } });
  const historyB = await call('/rest/v1/rescores?select=id', { token: b.token });
  const forgeHistory = await call('/rest/v1/rescores', { method: 'POST', token: a.token, body: { tool: TOOL, rows_changed: 1, points_changed: 1000 } });
  const forgeCorrection = await call('/rest/v1/engagements', { method: 'POST', token: a.token, body: { member_id: a.id, kind: 'made_task', points: 1000, tool: RESCORE_TOOL, rescore_id: randomUUID() } });
  check('nobody writes the game settings, the rescore history or a correction row through the API, and a viewer reads no history',
    (flipA.status >= 400 || flipA.json?.length === 0) && forgeHistory.status >= 400 && forgeCorrection.status >= 400 && historyB.status === 200 && historyB.json.length === 0,
    `settings HTTP ${flipA.status} ${JSON.stringify(flipA.json)}, history POST ${forgeHistory.status}, correction POST ${forgeCorrection.status}, history read ${JSON.stringify(historyB.json)}`);

  const phaseB = await call('/rest/v1/rpc/scoring_phase', { method: 'POST', token: b.token, body: {} });
  const phaseAnon = await call('/rest/v1/rpc/scoring_phase', { method: 'POST', body: {} });
  check('every member reads the scoring phase; a signed-out visitor cannot',
    phaseB.status === 200 && typeof phaseB.json?.[0]?.provisional === 'boolean' && phaseAnon.status >= 400,
    `member HTTP ${phaseB.status} ${JSON.stringify(phaseB.json)}, signed out HTTP ${phaseAnon.status}`);

  // scoring_rule_votes (20261127130000_scoring_rule_votes.sql): every member
  // reads every vote on what an action is worth; a member casts, changes and
  // withdraws only their own, through core. A vote changes no rule and no
  // ledger entry.
  {
    const KIND = 'voted_on_task';
    const ruleVotes = (member) => ({
      rules: async () => ((await call('/rest/v1/game_scoring_rules?select=kind,name,description,criteria,points,position', { token: member.token })).json ?? []),
      all: async () => ((await call('/rest/v1/scoring_rule_votes?select=*', { token: member.token })).json ?? []).map(fromVote),
      mine: async (kind) => fromVote((await call(`/rest/v1/scoring_rule_votes?kind=eq.${kind}&member_id=eq.${member.id}`, { token: member.token })).json?.[0]) ?? null,
      save: async (kind, points, tool) => {
        const got = await call('/rest/v1/scoring_rule_votes?on_conflict=kind,member_id', {
          method: 'POST', token: member.token, prefer: 'resolution=merge-duplicates,return=representation', body: { kind, member_id: member.id, points, tool },
        });
        if (got.status >= 300) throw new Error(`scoring_rule_votes save failed: HTTP ${got.status} ${JSON.stringify(got.json)}`);
        return fromVote(got.json[0]);
      },
      remove: async (kind) => {
        const got = await call(`/rest/v1/scoring_rule_votes?kind=eq.${kind}&member_id=eq.${member.id}`, { method: 'DELETE', token: member.token, prefer: 'return=representation' });
        return Array.isArray(got.json) && got.json.length > 0;
      },
    });
    function fromVote(r) {
      return r && { kind: r.kind, memberId: r.member_id, points: r.points, tool: r.tool, createdAt: r.created_at, updatedAt: r.updated_at };
    }
    const ruleBefore = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${KIND}&select=points`)).json?.[0]?.points;
    const ledgerBefore = (await admin('/rest/v1/engagements?select=id,points&order=id')).json ?? [];
    const rowsOf = async (member) => (await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&member_id=eq.${member.id}&select=points`, { token: a.token })).json ?? [];

    await castScoringRuleVote(ruleVotes(a), KIND, 3, TOOL);
    await castScoringRuleVote(ruleVotes(b), KIND, 6, TOOL);
    const seen = await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&select=member_id,points`, { token: a.token });
    check('a member reads every member’s vote on what an action is worth', seen.status === 200 && seen.json.length === 2, JSON.stringify(seen.json));
    const summary = summarizeScoringRuleVotes(await ruleVotes(a).all(), a.id).get(KIND);
    check('the members’ average of 3 and 6 is 5 (a half rounds up), and A’s own vote is 3', summary?.average === 5 && summary?.mine === 3 && summary?.voters === 2, JSON.stringify(summary));

    await castScoringRuleVote(ruleVotes(a), KIND, 4, TOOL);
    const aRows = await rowsOf(a);
    check('voting again changes A’s vote; it does not add a second one', aRows.length === 1 && aRows[0].points === 4, JSON.stringify(aRows));

    const bump = await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&member_id=eq.${b.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: 1000 } });
    check('A cannot change B’s vote on an action', bump.status === 200 && bump.json.length === 0 && (await rowsOf(b))[0]?.points === 6, `HTTP ${bump.status} ${JSON.stringify(bump.json)}`);
    const wipe = await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&member_id=eq.${b.id}`, { method: 'DELETE', token: a.token, prefer: 'return=representation' });
    check('A cannot withdraw B’s vote on an action', wipe.status === 200 && wipe.json.length === 0 && (await rowsOf(b)).length === 1, `HTTP ${wipe.status} ${JSON.stringify(wipe.json)}`);
    const forge = await call('/rest/v1/scoring_rule_votes', { method: 'POST', token: a.token, body: { kind: 'made_task', member_id: b.id, points: 1, tool: TOOL } });
    check('A cannot vote on an action in B’s name', forge.status >= 400, `HTTP ${forge.status} ${forge.json?.message ?? ''}`);
    const steal = await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&member_id=eq.${a.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { member_id: b.id } });
    check('A cannot hand A’s vote over to B', steal.status >= 400 || (Array.isArray(steal.json) && steal.json.length === 0), `HTTP ${steal.status} ${JSON.stringify(steal.json)}`);
    const neg = await call(`/rest/v1/scoring_rule_votes?kind=eq.${KIND}&member_id=eq.${a.id}`, { method: 'PATCH', token: a.token, prefer: 'return=representation', body: { points: -1 } });
    check('the table refuses a negative vote on an action', neg.status >= 400, `HTTP ${neg.status} ${neg.json?.message ?? ''}`);
    const ghost = await call('/rest/v1/scoring_rule_votes', { method: 'POST', token: a.token, body: { kind: 'no_such_action', member_id: a.id, points: 1, tool: TOOL } });
    const ghostCore = await castScoringRuleVote(ruleVotes(a), 'no_such_action', 1, TOOL).then(() => '', (e) => e.message);
    check('a vote on an action that does not exist is refused, by core and by the table', ghost.status >= 400 && /no action "no_such_action"/.test(ghostCore), `HTTP ${ghost.status} ${ghost.json?.message ?? ''}, core ${ghostCore}`);
    const anonWrite = await call('/rest/v1/scoring_rule_votes', { method: 'POST', body: { kind: KIND, member_id: a.id, points: 1, tool: TOOL } });
    const anonRead = await call('/rest/v1/scoring_rule_votes?select=points');
    check('a signed-out visitor cannot vote on an action, and reads no votes',
      anonWrite.status >= 400 && (anonRead.status >= 400 || (Array.isArray(anonRead.json) && anonRead.json.length === 0)), `write HTTP ${anonWrite.status}, read HTTP ${anonRead.status}`);

    const ruleAfter = (await admin(`/rest/v1/game_scoring_rules?kind=eq.${KIND}&select=points`)).json?.[0]?.points;
    const ledgerAfter = (await admin('/rest/v1/engagements?select=id,points&order=id')).json ?? [];
    check('votes on an action change neither its admin’s value nor any point in the ledger, and add no ledger entry',
      ruleAfter === ruleBefore && JSON.stringify(ledgerAfter) === JSON.stringify(ledgerBefore), `rule ${ruleBefore} → ${ruleAfter}, ledger ${ledgerBefore.length} → ${ledgerAfter.length} rows`);

    await castScoringRuleVote(ruleVotes(a), KIND, null, TOOL);
    await castScoringRuleVote(ruleVotes(b), KIND, null, TOOL);
    check('each member can withdraw their own vote on an action', (await rowsOf(a)).length === 0 && (await rowsOf(b)).length === 0, '');
  }

  // Making points final (20261103170000_scoring_final.sql) cannot be undone,
  // so every call to it runs only on the private test database, which
  // db:test rebuilds from nothing on every run.
  const testDbFinal = isLocalUrl(URL_) && phaseB.json?.[0]?.provisional === false;
  if (!isLocalUrl(URL_)) {
    console.log('SKIP  a real rescore and making points final: this is not the private test database; a rescore would change members\u2019 points, and final cannot be undone.');
  } else if (testDbFinal) {
    failures += 1;
    console.error('FAIL  points are already final on the test database, so a rescore cannot be tested. Run npm run db:test, which rebuilds it.');
  } else {
    const madeRule = (await admin('/rest/v1/game_scoring_rules?kind=eq.made_task&select=points')).json?.[0]?.points;
    const totalOf = async (member) => Number((await admin(`/rest/v1/engagement_totals?member_id=eq.${member.id}&select=points`)).json?.[0]?.points ?? 0);
    const ledgerOf = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&select=id,points,rescore_id&order=id`)).json ?? [];
    try {
      // Set the value with the service key, as a migration would: that scores nobody.
      await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', body: { points: madeRule + 3 } });
      const preview = await previewRescore(rescoreStore(a), { role: 'admin' });
      const made = preview.actions.find((r) => r.kind === 'made_task');
      const mine = preview.members.find((m) => m.memberId === a.id);
      const aTotal = await totalOf(a);
      const aBefore = await ledgerOf(a);
      check('an admin previews a rescore: today\u2019s value times the times done, and their own total now; nothing is saved',
        made?.wouldBe === made.timesDone * (madeRule + 3) && made.difference !== 0 && mine?.now === aTotal && JSON.stringify(await ledgerOf(a)) === JSON.stringify(aBefore),
        `${JSON.stringify(made)} ${JSON.stringify(mine)} total ${aTotal}`);
      // A rescore that saves also earns "Rescored past points" (WC-202), checked below.
      const rescoredRule = (await admin('/rest/v1/game_scoring_rules?kind=eq.rescored_past_points&select=points')).json?.[0]?.points;
      const saved = await applyRescore(rescoreStore(a), { role: 'admin' }, ['made_task'], TOOL);
      const aAfter = await ledgerOf(a);
      const corrections = (await admin(`/rest/v1/engagements?rescore_id=eq.${saved.rescoreId}&select=member_id,kind,points,tool,task_id`)).json ?? [];
      const history = (await call(`/rest/v1/rescores?id=eq.${saved.rescoreId}&select=run_by,tool,rows_changed,points_changed`, { token: a.token })).json?.[0];
      check('a rescore adds correction rows only, naming the rescore tool and the rescore, and records who ran it',
        saved.rows > 0 && corrections.length === saved.rows && corrections.every((e) => e.kind === 'made_task' && e.tool === RESCORE_TOOL && e.task_id === null)
          && aBefore.every((e) => aAfter.some((x) => x.id === e.id && x.points === e.points && x.rescore_id === null))
          && history?.run_by === a.id && history?.tool === TOOL && history?.rows_changed === saved.rows && history?.points_changed === saved.points,
        `${JSON.stringify(saved)} ${JSON.stringify(corrections)} ${JSON.stringify(history)}`);
      const aMade = (await rescoreStore(a).tallies()).find((t) => t.memberId === a.id && t.kind === 'made_task');
      check('afterwards A is credited today\u2019s value for every task they made, and their total says so',
        aMade?.credited === aMade.actions * (madeRule + 3) && await totalOf(a) === aTotal + (mine?.changes.made_task ?? 0) + rescoredRule, `${JSON.stringify(aMade)} total ${await totalOf(a)}`);
      const again = await applyRescore(rescoreStore(a), { role: 'admin' }, ['made_task'], TOOL);
      const direct = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: a.token, body: { rescore_kinds: ['made_task'], tool: TOOL } });
      check('rescoring again straight after changes nothing, through core or straight at the database', again.rows === 0 && again.rescoreId === null && direct.json?.rows === 0,
        `${JSON.stringify(again)} ${JSON.stringify(direct.json)}`);
      // "Rescored past points" earns its point (20261124030000_score_rescored_past_points.sql):
      // a rescore that saves records one, for the admin who ran it, naming its
      // tool; it is a real action, not a correction. One that changes nothing,
      // a refused one or a service-key one records none, and nobody forges one.
      {
        const rescoredOf = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.rescored_past_points&select=points,tool,task_id,rescore_id`)).json ?? [];
        const mineA = await rescoredOf(a);
        check('a rescore that saves records exactly one Rescored past points engagement for the admin who ran it, worth the rule\u2019s points, naming its tool; it is not a correction row',
          typeof rescoredRule === 'number' && mineA.length === 1 && mineA[0].points === rescoredRule && mineA[0].tool === TOOL && mineA[0].task_id === null && mineA[0].rescore_id === null
            && (await rescoredOf(b)).length === 0,
          `${JSON.stringify(mineA)} rule ${rescoredRule}`);
        const refusedB = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: b.token, body: { rescore_kinds: ['made_task'], tool: TOOL } });
        const blankTool = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: a.token, body: { rescore_kinds: ['made_task'], tool: ' ' } });
        const forgedA = await call('/rest/v1/engagements', { method: 'POST', token: a.token, body: { member_id: a.id, kind: 'rescored_past_points', points: 1, tool: TOOL } });
        const forgedB = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: 'rescored_past_points', points: 1, tool: TOOL } });
        // A service-key rescore (nobody signed in) saves unscored, even naming A as who ran it.
        const serviceRow = await admin('/rest/v1/rescores', { method: 'POST', prefer: 'return=representation', body: { run_by: a.id, tool: TOOL, rows_changed: 0, points_changed: 0 } });
        const serviceId = serviceRow.json?.[0]?.id;
        const serviceSave = serviceId ? await admin(`/rest/v1/rescores?id=eq.${serviceId}`, { method: 'PATCH', prefer: 'return=representation', body: { rows_changed: 1, points_changed: 1 } }) : { status: 0 };
        if (serviceId) await admin(`/rest/v1/rescores?id=eq.${serviceId}`, { method: 'DELETE' });
        check('a rescore that changes nothing, a refused one or a service-key one records no Rescored past points engagement, and no member can forge one',
          refusedB.status >= 400 && blankTool.status >= 400 && forgedA.status >= 400 && forgedB.status >= 400 && serviceSave.status < 300
            && (await rescoredOf(a)).length === 1 && (await rescoredOf(b)).length === 0,
          `viewer HTTP ${refusedB.status}, blank tool HTTP ${blankTool.status}, forged A HTTP ${forgedA.status}, forged B HTTP ${forgedB.status}, service save HTTP ${serviceSave.status}, A has ${(await rescoredOf(a)).length}`);
      }
      await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', body: { points: madeRule } });
      const phaseStore = (member) => ({
        phase: async () => {
          const r = await call('/rest/v1/rpc/scoring_phase', { method: 'POST', token: member.token, body: {} });
          if (r.status >= 300 || !r.json?.[0]) throw new Error(`scoring_phase refused: ${r.json?.message ?? r.status}`);
          const p = r.json[0];
          return { provisional: p.provisional, finalAt: p.final_at, finalBy: p.final_by, finalByName: p.final_by_name };
        },
        makeFinal: async (tool) => {
          const r = await call('/rest/v1/rpc/make_scoring_final', { method: 'POST', token: member.token, body: { tool }, tool });
          if (r.status >= 300) throw new Error(`make_scoring_final refused: ${r.json?.message ?? r.status}`);
          return { provisional: r.json.provisional, finalAt: r.json.final_at, finalBy: r.json.final_by, finalByName: null };
        },
      });
      const finalB = await call('/rest/v1/rpc/make_scoring_final', { method: 'POST', token: b.token, body: { tool: TOOL } });
      const finalAnon = await call('/rest/v1/rpc/make_scoring_final', { method: 'POST', body: { tool: TOOL } });
      const forgedFinalB = await makeScoringFinal(phaseStore(b), { role: 'admin' }, 'FINAL', TOOL).then(() => '', (e) => e.message);
      check('a viewer or a signed-out visitor cannot make points final, through core or straight at the database',
        finalB.status >= 400 && finalAnon.status >= 400 && /refused/.test(forgedFinalB) && (await phaseStore(a).phase()).provisional === true,
        `viewer HTTP ${finalB.status}, signed out HTTP ${finalAnon.status}, core ${forgedFinalB}`);
      // "Made points final" earns its point (WC-203), checked below.
      const finalRule = (await admin('/rest/v1/game_scoring_rules?kind=eq.made_points_final&select=points')).json?.[0]?.points;
      const finalsOf = async (member) => (await admin(`/rest/v1/engagements?member_id=eq.${member.id}&kind=eq.made_points_final&select=points,tool,task_id,rescore_id`)).json ?? [];
      const refusedFinals = [...await finalsOf(a), ...await finalsOf(b)].length;
      const finalised = await makeScoringFinal(phaseStore(a), { role: 'admin' }, 'FINAL', TOOL);
      const shownB = await phaseStore(b).phase();
      check('an admin makes points final: every member sees since when and by whom',
        finalised.provisional === false && finalised.finalBy === a.id && shownB.provisional === false && shownB.finalBy === a.id && shownB.finalAt === finalised.finalAt,
        `${JSON.stringify(finalised)} ${JSON.stringify(shownB)}`);
      const againCore = await makeScoringFinal(phaseStore(a), { role: 'admin' }, 'FINAL', TOOL).then(() => '', (e) => e.message);
      const againDb = await call('/rest/v1/rpc/make_scoring_final', { method: 'POST', token: a.token, body: { tool: TOOL } });
      check('making points final a second time is refused, through core or straight at the database',
        /already final/.test(againCore) && againDb.status >= 400 && /already final/.test(againDb.json?.message ?? ''), `core ${againCore}, database HTTP ${againDb.status} ${againDb.json?.message ?? ''}`);
      // "Made points final" earns its point (20261124040000_score_made_points_final.sql):
      // making points final records one, for the admin who did it, naming the
      // tool; the refused tries above and the second try record none, and
      // nobody forges one.
      {
        const mineA = await finalsOf(a);
        const forgedA = await call('/rest/v1/engagements', { method: 'POST', token: a.token, body: { member_id: a.id, kind: 'made_points_final', points: 1, tool: TOOL } });
        const forgedB = await call('/rest/v1/engagements', { method: 'POST', token: b.token, body: { member_id: b.id, kind: 'made_points_final', points: 1, tool: TOOL } });
        check('making points final records exactly one Made points final engagement for the admin who did it, worth the rule\u2019s points, naming its tool',
          typeof finalRule === 'number' && refusedFinals === 0 && mineA.length === 1 && mineA[0].points === finalRule && mineA[0].tool === TOOL && mineA[0].task_id === null && mineA[0].rescore_id === null,
          `${JSON.stringify(mineA)} rule ${finalRule}, before ${refusedFinals}`);
        check('a refused or second try at making points final records no Made points final engagement, and no member can forge one',
          forgedA.status >= 400 && forgedB.status >= 400 && (await finalsOf(a)).length === 1 && (await finalsOf(b)).length === 0,
          `forged A HTTP ${forgedA.status}, forged B HTTP ${forgedB.status}, A has ${(await finalsOf(a)).length}, B has ${(await finalsOf(b)).length}`);
      }
      // Even the service key, which passes row-level security, cannot undo it: the trigger refuses.
      const reopen = await admin('/rest/v1/game_settings?id=eq.true', { method: 'PATCH', prefer: 'return=representation', body: { scoring_provisional: true } });
      const restamp = await admin('/rest/v1/game_settings?id=eq.true', { method: 'PATCH', prefer: 'return=representation', body: { scoring_final_at: null } });
      const reassign = await admin('/rest/v1/game_settings?id=eq.true', { method: 'PATCH', prefer: 'return=representation', body: { scoring_final_by: b.id } });
      const wipe = await admin('/rest/v1/game_settings?id=eq.true', { method: 'DELETE' });
      const after = await phaseStore(b).phase();
      check('nobody can set points back to provisional, change when or who made them final, or delete the settings, even with the service key',
        reopen.status >= 400 && /cannot be undone/.test(reopen.json?.message ?? '') && reassign.status >= 400 && /cannot be changed/.test(reassign.json?.message ?? '') && wipe.status >= 400
          && after.provisional === false && after.finalBy === a.id && after.finalAt === finalised.finalAt,
        `reopen HTTP ${reopen.status} ${reopen.json?.message ?? ''}, restamp HTTP ${restamp.status} ${JSON.stringify(restamp.json)}, reassign HTTP ${reassign.status} ${reassign.json?.message ?? ''}, delete HTTP ${wipe.status}, now ${JSON.stringify(after)}`);
      const finalCore = await applyRescore(rescoreStore(a), { role: 'admin' }, ['made_task'], TOOL).then(() => '', (e) => e.message);
      const finalDb = await call('/rest/v1/rpc/apply_rescore', { method: 'POST', token: a.token, body: { rescore_kinds: ['made_task'], tool: TOOL } });
      check('once points are final, even an admin cannot rescore, through core or straight at the database',
        /Points are final/.test(finalCore) && finalDb.status >= 400 && /Points are final/.test(finalDb.json?.message ?? ''), `core ${finalCore}, database HTTP ${finalDb.status} ${finalDb.json?.message ?? ''}`);
      // Deleting the admin who made points final clears who, and nothing else:
      // the row must not keep pointing at an account that is gone.
      const goneA = await admin(`/auth/v1/admin/users/${a.id}`, { method: 'DELETE' });
      if (goneA.status < 300) users.splice(users.indexOf(a.id), 1);
      const row = (await admin('/rest/v1/game_settings?id=eq.true&select=scoring_provisional,scoring_final_at,scoring_final_by')).json?.[0];
      const afterGone = await phaseStore(b).phase().catch((e) => ({ error: e.message }));
      check('deleting the admin who made points final clears who; points stay final and every member still reads the phase',
        goneA.status < 300 && row?.scoring_final_by === null && row?.scoring_provisional === false
          && afterGone.provisional === false && afterGone.finalBy === null && afterGone.finalAt === finalised.finalAt,
        `delete HTTP ${goneA.status}, row ${JSON.stringify(row)}, phase ${JSON.stringify(afterGone)}`);
    } finally {
      // Points stay final on the test database: that cannot be undone, and db:test rebuilds it next run.
      await admin('/rest/v1/game_scoring_rules?kind=eq.made_task', { method: 'PATCH', body: { points: madeRule } });
    }
  }
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
