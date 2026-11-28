import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ROLE, MEMBER_ACTIONS, PERMISSIONS, ROLES, STARTING_ROLE_PERMISSIONS, mayDo, mayManageMembers, mayOpenAdmin, maySeeMemberEmails, memberActions, signInMethodLabel,
  memberPermissions, roleOf, setMemberRole,
} from './members.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';

const TOOL = 'wavecenter';

function setup() {
  const store = new MemoryMemberRoleStore();
  store.rows.set('dane', { role: 'admin', tool: 'migration' });
  return store;
}

test('the five roles Dane listed, the four task permissions, the two member ones, the two team ones, the game one, Message members, Edit Home boxes, Manage website and the two anyone\'s-task ones', () => {
  assert.deepEqual(ROLES.map((r) => r.key), ['admin', 'editor', 'contributor', 'reviewer', 'viewer']);
  assert.deepEqual(PERMISSIONS.map((p) => p.key), [
    'task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'member.edit', 'team.read', 'team.edit', 'game.edit', 'member.message', 'home.edit', 'site.edit',
    'task.edit.any', 'task.delete.any',
  ]);
});

test('the migrations seed exactly the roles, permissions and grants core knows', () => {
  const read = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const files = [
    read('20261029120000_member_roles.sql'), read('20261029210000_member_permissions.sql'),
    read('20261031120000_teams.sql'), read('20261031140000_game_scoring_admin.sql'), read('20261031150000_messages.sql'),
    read('20261101130000_message_every_member.sql'), read('20261102130000_home_boxes.sql'),
    read('20261124120000_site_pages.sql'), read('20261127130000_task_role_permissions.sql'),
  ];
  const roles = [...files[0].matchAll(/^\s*\('([a-z_]+)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+)\)/gm)]
    .map((m) => ({ key: m[1], name: m[2], description: m[3].replace(/''/g, "'") }));
  assert.deepEqual(roles, ROLES);
  const perms = files.flatMap((sql) => [...sql.matchAll(/^\s*\('([a-z]+(?:\.[a-z_]+)+)',\s*'((?:[^']|'')*)',\s*(\d+)\)/gm)])
    .map((m) => ({ key: m[1], label: m[2].replace(/''/g, "'"), position: Number(m[3]) }));
  assert.deepEqual(perms.map(({ key, label }) => ({ key, label })), PERMISSIONS);
  assert.deepEqual(perms.map((p) => p.position), PERMISSIONS.map((_, i) => i + 1));
  const grants: Record<string, string[]> = {};
  for (const sql of files) {
    const block = sql.slice(sql.indexOf('insert into public.role_permissions'));
    for (const m of block.slice(0, block.indexOf('on conflict do nothing')).matchAll(/\('([a-z_]+)',\s*'([a-z.]+)'\)/g)) (grants[m[1]] ??= []).push(m[2]);
  }
  assert.deepEqual(grants, STARTING_ROLE_PERMISSIONS);
});

test('memberPermissions gives each role its grants; admin has all fourteen, editor all six task ones', () => {
  assert.deepEqual(memberPermissions('admin'), PERMISSIONS.map((p) => p.key));
  assert.deepEqual(memberPermissions('editor'), ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'team.read', 'team.edit', 'member.message', 'task.edit.any', 'task.delete.any']);
  assert.deepEqual(memberPermissions('contributor'), ['task.read', 'task.create', 'task.edit', 'member.read', 'team.read', 'member.message', 'task.delete']);
  assert.deepEqual(memberPermissions('reviewer'), ['task.read', 'member.read', 'team.read', 'member.message']);
  assert.deepEqual(memberPermissions('viewer'), ['task.read', 'member.read', 'team.read', 'member.message']);
  assert.deepEqual(memberPermissions('viewer', { viewer: ['task.read', 'task.comment'] }), ['task.read', 'task.comment']);
});

test('every role views and messages the members; only an admin changes roles, manages game scoring or edits Home', () => {
  for (const r of ROLES) assert.equal(mayDo(r.key, 'home.edit'), r.key === 'admin', r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'site.edit'), r.key === 'admin', r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'member.read'), true, r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'member.edit'), r.key === 'admin', r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'game.edit'), r.key === 'admin', r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'member.message'), true, r.key);
  assert.equal(mayDo(null, 'member.read'), false);
  assert.equal(mayDo(undefined, 'member.read'), false);
});

test('every role views the teams; admins and editors manage them', () => {
  for (const r of ROLES) assert.equal(mayDo(r.key, 'team.read'), true, r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'team.edit'), r.key === 'admin' || r.key === 'editor', r.key);
});

test('mayDo follows the grants the database holds, not only the starting ones', () => {
  assert.equal(mayDo('editor', 'member.edit', { editor: ['member.edit'] }), true);
  assert.equal(mayDo('admin', 'member.edit', { admin: ['member.read'] }), false);
  assert.equal(mayDo('admin', 'member.edit', {}), false);
});

test('the member-table buttons: an admin gets Change role, Message and Chat, everyone else gets Message and Chat', () => {
  assert.deepEqual(MEMBER_ACTIONS.map((a) => a.key), ['change-role', 'message', 'chat']);
  assert.deepEqual(memberActions('admin'), ['change-role', 'message', 'chat']);
  assert.deepEqual(memberActions('admin', { admin: ['member.message'] }), ['message', 'chat']);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer'] as const) assert.deepEqual(memberActions(role), ['message', 'chat'], role);
  assert.deepEqual(memberActions(null), []);
  assert.deepEqual(memberActions('admin', { admin: ['member.read'] }), []);
});

test('only an admin may manage members', () => {
  assert.equal(mayManageMembers('admin'), true);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer', null] as const) assert.equal(mayManageMembers(role), false, String(role));
});

test('only an admin may open the Admin area; an unread role may not', () => {
  assert.equal(mayOpenAdmin('admin'), true);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer', null, undefined] as const) assert.equal(mayOpenAdmin(role), false, String(role));
});

test('only an admin may see members\u2019 email addresses; an unread role may not', () => {
  assert.equal(maySeeMemberEmails('admin'), true);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer', null, undefined] as const) assert.equal(maySeeMemberEmails(role), false, String(role));
});

test('the sign-in method reads Google, Email, or Google and email', () => {
  assert.equal(signInMethodLabel(['google']), 'Google');
  assert.equal(signInMethodLabel(['email']), 'Email');
  assert.equal(signInMethodLabel(['email', 'google']), 'Google and email');
  assert.equal(signInMethodLabel(['google', 'email', 'google']), 'Google and email');
  assert.equal(signInMethodLabel(['github', 'email']), 'Email and github');
  assert.equal(signInMethodLabel([]), 'Unknown');
});

test('a member with no role recorded is a contributor', async () => {
  assert.equal(DEFAULT_ROLE, 'contributor');
  assert.equal(await roleOf(setup(), 'newcomer'), 'contributor');
});

test('an admin changes a member\'s role, and the change names its tool', async () => {
  const store = setup();
  assert.equal(await setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'viewer' }, TOOL), 'viewer');
  assert.deepEqual(store.rows.get('lee'), { role: 'viewer', tool: TOOL });
});

test('a non-admin cannot change any role, even their own', async () => {
  const store = setup();
  store.rows.set('lee', { role: 'editor', tool: TOOL });
  await assert.rejects(setMemberRole(store, { actorId: 'lee', memberId: 'sasha', role: 'viewer' }, TOOL), /Only an admin/);
  await assert.rejects(setMemberRole(store, { actorId: 'lee', memberId: 'lee', role: 'admin' }, TOOL), /Only an admin/);
  await assert.rejects(setMemberRole(store, { actorId: 'sasha', memberId: 'sasha', role: 'admin' }, TOOL), /Only an admin/);
  assert.equal(store.rows.get('lee')?.role, 'editor');
  assert.equal(store.rows.has('sasha'), false);
});

test('the last admin cannot be made anything else', async () => {
  const store = setup();
  await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'dane', role: 'viewer' }, TOOL), /last admin/);
  assert.equal(store.rows.get('dane')?.role, 'admin');
  await setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'admin' }, TOOL);
  assert.equal(await setMemberRole(store, { actorId: 'dane', memberId: 'dane', role: 'editor' }, TOOL), 'editor');
  await assert.rejects(setMemberRole(store, { actorId: 'lee', memberId: 'lee', role: 'viewer' }, TOOL), /last admin/);
});

test('a change with no tool name is refused', async () => {
  const store = setup();
  for (const tool of ['', '   ', undefined as never]) {
    await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'viewer' }, tool), /must name the tool/);
  }
  assert.equal(store.rows.has('lee'), false);
});

test('a role core does not know is refused', async () => {
  await assert.rejects(setMemberRole(setup(), { actorId: 'dane', memberId: 'lee', role: 'owner' }, TOOL), /not one of WaveCenter's roles/);
});

test('a save that does not land is reported, never called saved', async () => {
  const store = setup();
  store.failNextSave = true;
  await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'viewer' }, TOOL), /did not save/);
});

test('changing a member role records one engagement, credited to the admin who changed it, not the member', async () => {
  const ledger = new MemoryEngagementStore();
  const store = new MemoryMemberRoleStore(ledger);
  store.rows.set('dane', { role: 'admin', tool: 'migration' });
  store.signedIn = 'dane';
  await setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'viewer' }, 'members-tool');
  assert.deepEqual(ledger.rows.map((e) => [e.memberId, e.kind, e.points, e.tool, e.taskId]), [['dane', 'changed_a_member_s_role', 1, 'members-tool', null]]);

  // Saved as the same role (a member with no row is a contributor already): not a change, nothing recorded.
  await setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'viewer' }, TOOL);
  await setMemberRole(store, { actorId: 'dane', memberId: 'sasha', role: 'contributor' }, TOOL);
  assert.equal(ledger.rows.length, 1);

  // Refused or failed: nothing is recorded, and the failure says so.
  store.signedIn = 'lee';
  await assert.rejects(setMemberRole(store, { actorId: 'lee', memberId: 'lee', role: 'admin' }, TOOL), /Only an admin/);
  store.signedIn = 'dane';
  await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'dane', role: 'viewer' }, TOOL), /last admin/);
  store.failNextSave = true;
  await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'editor' }, TOOL), /did not save/);
  assert.equal(ledger.rows.length, 1);

  // A second change is a second engagement, still the admin's, never the member's.
  await setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'editor' }, TOOL);
  assert.deepEqual(ledger.rows.map((e) => e.memberId), ['dane', 'dane']);

  // If the engagement cannot be written, the role does not change either.
  ledger.failInsert = true;
  await assert.rejects(setMemberRole(store, { actorId: 'dane', memberId: 'lee', role: 'reviewer' }, TOOL), /ledger is down/);
  assert.equal(store.rows.get('lee')?.role, 'editor');
});

test('the task permissions per role: admins and editors change and delete anyone\'s task, contributors add and change their own, reviewers and viewers only read (WC-248)', () => {
  const want: Record<string, string[]> = {
    admin: ['task.read', 'task.create', 'task.edit', 'task.delete', 'task.edit.any', 'task.delete.any'],
    editor: ['task.read', 'task.create', 'task.edit', 'task.delete', 'task.edit.any', 'task.delete.any'],
    contributor: ['task.read', 'task.create', 'task.edit', 'task.delete'],
    reviewer: ['task.read'],
    viewer: ['task.read'],
  };
  for (const r of ROLES) {
    assert.deepEqual(memberPermissions(r.key).filter((p) => p.startsWith('task.')).sort(), want[r.key].sort(), r.key);
  }
});
