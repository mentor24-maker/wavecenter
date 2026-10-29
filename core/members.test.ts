import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ROLE, PERMISSIONS, ROLES, STARTING_ROLE_PERMISSIONS, mayManageMembers, memberPermissions, roleOf, setMemberRole,
} from './members.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';

const TOOL = 'wavecenter';

function setup() {
  const store = new MemoryMemberRoleStore();
  store.rows.set('dane', { role: 'admin', tool: 'migration' });
  return store;
}

test('the five roles and four permissions Dane listed, in his order', () => {
  assert.deepEqual(ROLES.map((r) => r.key), ['admin', 'editor', 'contributor', 'reviewer', 'viewer']);
  assert.deepEqual(PERMISSIONS.map((p) => p.key), ['task.read', 'task.create', 'task.edit', 'task.delete']);
});

test('the migration seeds exactly the roles, permissions and grants core knows', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261029120000_member_roles.sql', import.meta.url), 'utf8');
  const roles = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*'([^']*)',\s*'((?:[^']|'')*)',\s*(\d+)\)/gm)]
    .map((m) => ({ key: m[1], name: m[2], description: m[3].replace(/''/g, "'") }));
  assert.deepEqual(roles, ROLES);
  const perms = [...sql.matchAll(/^\s*\('(task\.[a-z_]+)',\s*'([^']*)',\s*(\d+)\)/gm)].map((m) => ({ key: m[1], label: m[2] }));
  assert.deepEqual(perms, PERMISSIONS);
  const grants: Record<string, string[]> = {};
  const block = sql.slice(sql.indexOf('insert into public.role_permissions'), sql.indexOf('on conflict do nothing'));
  for (const m of block.matchAll(/\('([a-z_]+)',\s*'([a-z.]+)'\)/g)) (grants[m[1]] ??= []).push(m[2]);
  assert.deepEqual(grants, STARTING_ROLE_PERMISSIONS);
});

test('memberPermissions gives each role its grants; admin and editor have all four', () => {
  assert.deepEqual(memberPermissions('admin'), ['task.read', 'task.create', 'task.edit', 'task.delete']);
  assert.deepEqual(memberPermissions('editor'), memberPermissions('admin'));
  assert.deepEqual(memberPermissions('contributor'), ['task.read', 'task.create', 'task.edit']);
  assert.deepEqual(memberPermissions('reviewer'), ['task.read']);
  assert.deepEqual(memberPermissions('viewer'), ['task.read']);
  assert.deepEqual(memberPermissions('viewer', { viewer: ['task.read', 'task.comment'] }), ['task.read', 'task.comment']);
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
