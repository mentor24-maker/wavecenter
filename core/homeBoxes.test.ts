import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_BOXES, HOME_BOX_MAX, homeBoxWords, isHomeBox, mayEditHomeBoxes, saveHomeBox, type HomeBoxDeps } from './homeBoxes.ts';
import { ROLES } from './members.ts';
import { MemoryHomeBoxStore } from './memoryHomeBoxStore.ts';
import { MemoryMemberRoleStore } from './memoryMemberRoleStore.ts';

const TOOL = 'wavecenter';

function setup(): HomeBoxDeps & { boxes: MemoryHomeBoxStore; roles: MemoryMemberRoleStore } {
  const roles = new MemoryMemberRoleStore();
  roles.rows.set('dane', { role: 'admin', tool: 'migration' });
  roles.rows.set('eddie', { role: 'editor', tool: TOOL });
  roles.rows.set('vee', { role: 'viewer', tool: TOOL });
  return { boxes: new MemoryHomeBoxStore(), roles };
}

test('only About WaveCenter and What is a DEO are editable for now (Dane, "B")', () => {
  assert.deepEqual(HOME_BOXES.map((b) => b.key), ['about', 'deo']);
  assert.equal(isHomeBox('about'), true);
  for (const other of ['members', 'leaderboard', 'working', 'completed', 'evolution', '', null]) assert.equal(isHomeBox(other), false, String(other));
});

test('the migration allows the same boxes and the same length core does', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261102130000_home_boxes.sql', import.meta.url), 'utf8');
  const keys = sql.match(/check \(box in \(([^)]*)\)\)/)![1].split(',').map((k) => k.trim().replace(/'/g, ''));
  assert.deepEqual(keys, HOME_BOXES.map((b) => b.key));
  assert.match(sql, new RegExp(`length\\(body\\) <= ${HOME_BOX_MAX}\\b`));
  assert.match(sql, /alter table public\.home_boxes enable row level security/);
});

test('only an admin edits Home at the start; the database grants decide after that', () => {
  assert.deepEqual(ROLES.filter((r) => mayEditHomeBoxes(r.key)).map((r) => r.key), ['admin']);
  assert.equal(mayEditHomeBoxes(null), false);
  assert.equal(mayEditHomeBoxes('editor', { editor: ['home.edit'] }), true);
  assert.equal(mayEditHomeBoxes('admin', { admin: ['team.read'] }), false);
});

test('a box with no saved words shows the words it was built with', () => {
  assert.equal(homeBoxWords('about', []), 'The hub of the DEO movement: what it is for and where it is going.');
  assert.equal(homeBoxWords('deo', []), 'A DEO transforms human engagement into collective ownership, intelligence, and economic value through decentralized collaboration, shared governance, and technology.');
  const saved = [{ box: 'about' as const, body: 'New **words**', tool: TOOL, updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'dane' }];
  assert.equal(homeBoxWords('about', saved), 'New **words**');
  assert.equal(homeBoxWords('deo', saved), 'A DEO transforms human engagement into collective ownership, intelligence, and economic value through decentralized collaboration, shared governance, and technology.');
});

test('an admin saves a box’s words, trimmed, naming the tool', async () => {
  const deps = setup();
  const saved = await saveHomeBox(deps, { actorId: 'dane', box: 'about', body: '  The **hub**, see [the canon](https://example.com).\n' }, TOOL);
  assert.equal(saved.body, 'The **hub**, see [the canon](https://example.com).');
  assert.equal(deps.boxes.rows.get('about')?.tool, TOOL);
  assert.equal(homeBoxWords('about', await deps.boxes.list()), saved.body);
});

test('a role without home.edit is refused, and nothing changes', async () => {
  const deps = setup();
  for (const actorId of ['eddie', 'vee', 'stranger']) {
    await assert.rejects(saveHomeBox(deps, { actorId, box: 'about', body: 'Hijacked' }, TOOL), /may not change the words on Home/, actorId);
  }
  assert.equal(deps.boxes.rows.size, 0);
  // Given the permission on the Admin page, an editor may.
  await saveHomeBox({ ...deps, grants: { editor: ['home.edit'] } }, { actorId: 'eddie', box: 'deo', body: 'Edited' }, TOOL);
  assert.equal(deps.boxes.rows.get('deo')?.body, 'Edited');
});

test('a box that is not editable, empty words, too many words or no tool are refused', async () => {
  const deps = setup();
  await assert.rejects(saveHomeBox(deps, { actorId: 'dane', box: 'leaderboard', body: 'x' }, TOOL), /not one of Home's editable boxes/);
  await assert.rejects(saveHomeBox(deps, { actorId: 'dane', box: 'about', body: ' \n\t ' }, TOOL), /needs some words/);
  await assert.rejects(saveHomeBox(deps, { actorId: 'dane', box: 'about', body: 'x'.repeat(HOME_BOX_MAX + 1) }, TOOL), /at most 2,000/);
  await assert.rejects(saveHomeBox(deps, { actorId: 'dane', box: 'about', body: 'x' }, ' '), /must name the tool/);
  assert.equal(deps.boxes.rows.size, 0);
});

test('a save that does not come back is reported as failed (rule 6)', async () => {
  const deps = setup();
  deps.boxes.failNextSave = true;
  await assert.rejects(saveHomeBox(deps, { actorId: 'dane', box: 'about', body: 'New' }, TOOL), /did not save/);
});
