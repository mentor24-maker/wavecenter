import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';
import { MemoryTeamStore } from './memoryTeamStore.ts';
import {
  addTeamMember, checkTeam, createTeam, deleteTeam, mayManageTeams, mayViewTeams, removeTeamMember, slugFromName,
  updateTeam, type TeamDeps,
} from './teams.ts';
import { ROLES } from './members.ts';

const TOOL = 'wavecenter';

function setup(): TeamDeps & { teams: MemoryTeamStore; roles: MemoryMemberRoleStore } {
  const roles = new MemoryMemberRoleStore();
  roles.rows.set('dane', { role: 'admin', tool: 'migration' });
  roles.rows.set('eddie', { role: 'editor', tool: TOOL });
  roles.rows.set('vee', { role: 'viewer', tool: TOOL });
  return { teams: new MemoryTeamStore(), roles };
}

const TEST_TEAM = { name: 'Test Team', slug: 'test-team', description: 'Trying teams out.' };

test('every role views teams; only admins and editors manage them (Dane, "B")', () => {
  for (const r of ROLES) assert.equal(mayViewTeams(r.key), true, r.key);
  assert.deepEqual(ROLES.filter((r) => mayManageTeams(r.key)).map((r) => r.key), ['admin', 'editor']);
  assert.equal(mayViewTeams(null), false);
  assert.equal(mayManageTeams('viewer', { viewer: ['team.edit'] }), true);
  assert.equal(mayManageTeams('admin', { admin: ['team.read'] }), false);
});

test('a slug is suggested from the name', () => {
  assert.equal(slugFromName('Test Team'), 'test-team');
  assert.equal(slugFromName('  Café — Crew #2! '), 'cafe-crew-2');
  assert.equal(slugFromName('!!!'), '');
});

test('checkTeam tidies the fields and fills a blank slug from the name', () => {
  assert.deepEqual(checkTeam({ name: '  Test Team ', slug: '', description: '   ' }), { name: 'Test Team', slug: 'test-team', description: null });
  assert.deepEqual(checkTeam({ name: 'X', slug: ' x-1 ', description: ' hi ' }), { name: 'X', slug: 'x-1', description: 'hi' });
});

test('a malformed slug, a missing name or an over-long field is refused with the reason', () => {
  assert.throws(() => checkTeam({ name: '', slug: 'a', description: null }), /needs a name/);
  for (const slug of ['Test-Team', 'test team', 'test--team', '-test', 'test-', 'tést', 'a_b']) {
    assert.throws(() => checkTeam({ name: 'T', slug, description: null }), /lowercase letters, digits and single hyphens/, slug);
  }
  assert.throws(() => checkTeam({ name: '!!!', slug: '', description: null }), /needs a slug/);
  assert.throws(() => checkTeam({ name: 'n'.repeat(81), slug: 'a', description: null }), /at most 80/);
  assert.throws(() => checkTeam({ name: 'T', slug: 'a'.repeat(61), description: null }), /at most 60/);
  assert.throws(() => checkTeam({ name: 'T', slug: 'a', description: 'd'.repeat(501) }), /at most 500/);
});

test('an admin and an editor make a team, and the change names its tool', async () => {
  const deps = setup();
  const made = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  assert.equal(made.name, 'Test Team');
  assert.equal(made.tool, TOOL);
  const byEditor = await createTeam(deps, { actorId: 'eddie', name: 'Editors', slug: '', description: null }, TOOL);
  assert.equal(byEditor.slug, 'editors');
  assert.equal(deps.teams.teams.size, 2);
});

test('a viewer or a contributor cannot make, change or delete a team', async () => {
  const deps = setup();
  const team = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  for (const actorId of ['vee', 'newcomer']) {
    await assert.rejects(createTeam(deps, { actorId, ...TEST_TEAM, slug: 'other' }, TOOL), /Only an admin or an editor/);
    await assert.rejects(updateTeam(deps, { actorId, teamId: team.id, ...TEST_TEAM, name: 'Renamed' }, TOOL), /Only an admin or an editor/);
    await assert.rejects(deleteTeam(deps, { actorId, teamId: team.id }, TOOL), /Only an admin or an editor/);
    await assert.rejects(addTeamMember(deps, { actorId, teamId: team.id, memberId: actorId }, TOOL), /Only an admin or an editor/);
  }
  assert.equal(deps.teams.teams.size, 1);
  assert.equal(deps.teams.teams.get(team.id)?.name, 'Test Team');
});

test('core follows the grants the database holds', async () => {
  const deps = { ...setup(), grants: { viewer: ['team.read', 'team.edit'], admin: ['team.read'] } };
  await createTeam(deps, { actorId: 'vee', ...TEST_TEAM }, TOOL);
  await assert.rejects(createTeam(deps, { actorId: 'dane', ...TEST_TEAM, slug: 'two' }, TOOL), /Only an admin or an editor/);
});

test('a duplicate slug is refused, saying it is taken', async () => {
  const deps = setup();
  const first = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  await assert.rejects(createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL), /"test-team" is already taken/);
  const other = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM, slug: 'other' }, TOOL);
  await assert.rejects(updateTeam(deps, { actorId: 'dane', teamId: other.id, ...TEST_TEAM }, TOOL), /already taken/);
  // A team keeps its own slug when its other fields change.
  const kept = await updateTeam(deps, { actorId: 'dane', teamId: first.id, ...TEST_TEAM, description: 'New words.' }, TOOL);
  assert.equal(kept.description, 'New words.');
});

test('a manager edits each of the three fields', async () => {
  const deps = setup();
  const team = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  const saved = await updateTeam(deps, { actorId: 'eddie', teamId: team.id, name: 'Renamed', slug: 'renamed', description: '' }, TOOL);
  assert.deepEqual([saved.name, saved.slug, saved.description], ['Renamed', 'renamed', null]);
});

test('deleting a team removes its member links and no member', async () => {
  const deps = setup();
  const team = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  await addTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: 'vee' }, TOOL);
  await deleteTeam(deps, { actorId: 'eddie', teamId: team.id }, TOOL);
  assert.equal(deps.teams.teams.size, 0);
  assert.equal(deps.teams.members.has(team.id), false);
  assert.equal(deps.roles.rows.get('vee')?.role, 'viewer');
  await assert.rejects(deleteTeam(deps, { actorId: 'dane', teamId: team.id }, TOOL), /no longer exists/);
});

test('a manager adds and removes a member; adding twice or removing a non-member says so', async () => {
  const deps = setup();
  const team = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  await addTeamMember(deps, { actorId: 'eddie', teamId: team.id, memberId: 'vee' }, TOOL);
  assert.equal(deps.teams.members.get(team.id)?.get('vee'), TOOL);
  await assert.rejects(addTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: 'vee' }, TOOL), /already on this team/);
  await assert.rejects(addTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: '' }, TOOL), /Pick a member/);
  await removeTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: 'vee' }, TOOL);
  assert.equal(await deps.teams.hasMember(team.id, 'vee'), false);
  await assert.rejects(removeTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: 'vee' }, TOOL), /not on this team/);
});

test('a change with no tool name is refused', async () => {
  const deps = setup();
  for (const tool of ['', '   ', undefined as never]) {
    await assert.rejects(createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, tool), /must name the tool/);
  }
  assert.equal(deps.teams.teams.size, 0);
});

test('a save that does not land is reported, never called saved', async () => {
  const deps = setup();
  deps.teams.failNextSave = true;
  await assert.rejects(createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL), /did not save/);
  const team = await createTeam(deps, { actorId: 'dane', ...TEST_TEAM }, TOOL);
  deps.teams.failNextSave = true;
  await assert.rejects(updateTeam(deps, { actorId: 'dane', teamId: team.id, ...TEST_TEAM, name: 'X' }, TOOL), /did not save/);
  assert.equal(deps.teams.teams.get(team.id)?.name, 'Test Team');
  deps.teams.failNextSave = true;
  await assert.rejects(addTeamMember(deps, { actorId: 'dane', teamId: team.id, memberId: 'vee' }, TOOL), /not added/);
  deps.teams.failNextSave = true;
  await assert.rejects(deleteTeam(deps, { actorId: 'dane', teamId: team.id }, TOOL), /not deleted/);
  assert.equal(deps.teams.teams.size, 1);
});
