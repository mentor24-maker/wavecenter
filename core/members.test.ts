import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ROLE, MEMBER_ACTIONS, PERMISSIONS, ROLES, STARTING_ROLE_PERMISSIONS, mayDo, mayManageMembers, memberActions,
  memberPermissions, roleOf, setMemberRole,
} from './members.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';

const TOOL = 'wavecenter';

function setup() {
  const store = new MemoryMemberRoleStore();
  store.rows.set('dane', { role: 'admin', tool: 'migration' });
  return store;
}

test('the five roles Dane listed, the four task permissions, and the two member ones', () => {
  assert.deepEqual(ROLES.map((r) => r.key), ['admin', 'editor', 'contributor', 'reviewer', 'viewer']);
  assert.deepEqual(PERMISSIONS.map((p) => p.key), ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read', 'member.edit']);
});

test('the migrations seed exactly the roles, permissions and grants core knows', () => {
  const read = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
  const files = [read('20261029120000_member_roles.sql'), read('20261029210000_member_permissions.sql')];
  const roles = [...files[0].matchAll(/^\s*\('([a-z_]+)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+)\)/gm)]
    .map((m) => ({ key: m[1], name: m[2], description: m[3].replace(/''/g, "'") }));
  assert.deepEqual(roles, ROLES);
  const perms = files.flatMap((sql) => [...sql.matchAll(/^\s*\('([a-z]+\.[a-z_]+)',\s*'([^']*)',\s*(\d+)\)/gm)])
    .map((m) => ({ key: m[1], label: m[2], position: Number(m[3]) }));
  assert.deepEqual(perms.map(({ key, label }) => ({ key, label })), PERMISSIONS);
  assert.deepEqual(perms.map((p) => p.position), PERMISSIONS.map((_, i) => i + 1));
  const grants: Record<string, string[]> = {};
  for (const sql of files) {
    const block = sql.slice(sql.indexOf('insert into public.role_permissions'));
    for (const m of block.slice(0, block.indexOf('on conflict do nothing')).matchAll(/\('([a-z_]+)',\s*'([a-z.]+)'\)/g)) (grants[m[1]] ??= []).push(m[2]);
  }
  assert.deepEqual(grants, STARTING_ROLE_PERMISSIONS);
});

test('memberPermissions gives each role its grants; admin has all six, editor all four task ones', () => {
  assert.deepEqual(memberPermissions('admin'), PERMISSIONS.map((p) => p.key));
  assert.deepEqual(memberPermissions('editor'), ['task.read', 'task.create', 'task.edit', 'task.delete', 'member.read']);
  assert.deepEqual(memberPermissions('contributor'), ['task.read', 'task.create', 'task.edit', 'member.read']);
  assert.deepEqual(memberPermissions('reviewer'), ['task.read', 'member.read']);
  assert.deepEqual(memberPermissions('viewer'), ['task.read', 'member.read']);
  assert.deepEqual(memberPermissions('viewer', { viewer: ['task.read', 'task.comment'] }), ['task.read', 'task.comment']);
});

test('every role views the members; only an admin changes roles', () => {
  for (const r of ROLES) assert.equal(mayDo(r.key, 'member.read'), true, r.key);
  for (const r of ROLES) assert.equal(mayDo(r.key, 'member.edit'), r.key === 'admin', r.key);
  assert.equal(mayDo(null, 'member.read'), false);
  assert.equal(mayDo(undefined, 'member.read'), false);
});

test('mayDo follows the grants the database holds, not only the starting ones', () => {
  assert.equal(mayDo('editor', 'member.edit', { editor: ['member.edit'] }), true);
  assert.equal(mayDo('admin', 'member.edit', { admin: ['member.read'] }), false);
  assert.equal(mayDo('admin', 'member.edit', {}), false);
});

test('the member-table buttons: an admin gets Change role, everyone else gets none', () => {
  assert.deepEqual(MEMBER_ACTIONS.map((a) => a.key), ['change-role']);
  assert.deepEqual(memberActions('admin'), ['change-role']);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer', null] as const) assert.deepEqual(memberActions(role), [], String(role));
  assert.deepEqual(memberActions('admin', { admin: ['member.read'] }), []);
});

test('only an admin may manage members', () => {
  assert.equal(mayManageMembers('admin'), true);
  for (const role of ['editor', 'contributor', 'reviewer', 'viewer', null] as const) assert.equal(mayManageMembers(role), false, String(role));
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
