import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameActor } from './game.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';
import { MemoryTokenStore } from './memoryTokenStore.ts';
import {
  TOKEN_DIAMETER_MAX,
  TOKEN_DIAMETER_MIN,
  TOKEN_NAME_MAX,
  addTokenSize,
  changeTokenSize,
  checkTokenSize,
  removeTokenSize,
  tokenSizeFor,
  tokensToPlay,
  type Earning,
} from './tokens.ts';

const TOOL = 'wavecenter';
const ADMIN: GameActor = { role: 'admin' };
const EDITOR: GameActor = { role: 'editor' };

const small = { name: 'Small', diameter: 14, color: '#38bdf8', minPoints: 1 };
const medium = { name: 'Medium', diameter: 20, color: '#f59e0b', minPoints: 5 };
const large = { name: 'Large', diameter: 28, color: '#e11d48', minPoints: 20 };

async function seeded() {
  const store = new MemoryTokenStore();
  for (const s of [small, medium, large]) await addTokenSize(store, ADMIN, s, TOOL);
  return store;
}

test('a size is checked and tidied: name trimmed, numbers from text, colour lowercase', () => {
  assert.deepEqual(checkTokenSize({ name: '  Huge ', diameter: '40', color: '#AABBCC', minPoints: ' 50 ' }), { name: 'Huge', diameter: 40, color: '#aabbcc', minPoints: 50 });
});

test('a size needs a name of sane length', () => {
  assert.throws(() => checkTokenSize({ ...small, name: '  ' }), /needs a name/);
  assert.throws(() => checkTokenSize({ ...small, name: 'x'.repeat(TOKEN_NAME_MAX + 1) }), /at most 40/);
});

test('a size is a whole number of pixels within the range', () => {
  for (const bad of [TOKEN_DIAMETER_MIN - 1, TOKEN_DIAMETER_MAX + 1, 12.5, '', 'big', null, -10]) {
    assert.throws(() => checkTokenSize({ ...small, diameter: bad }), /whole number of pixels from 8 to 64/, String(bad));
  }
  assert.equal(checkTokenSize({ ...small, diameter: TOKEN_DIAMETER_MIN }).diameter, 8);
  assert.equal(checkTokenSize({ ...small, diameter: TOKEN_DIAMETER_MAX }).diameter, 64);
});

test('the colour is a #rrggbb hex', () => {
  for (const bad of ['red', '#fff', '#12345g', 'f59e0b', '', null]) {
    assert.throws(() => checkTokenSize({ ...small, color: bad }), /hex colour/, String(bad));
  }
});

test('the point level is a whole number, 1 or more', () => {
  for (const bad of [0, -1, 2.5, '', 'five', null]) {
    assert.throws(() => checkTokenSize({ ...small, minPoints: bad }), /whole number, 1 or more/, String(bad));
  }
});

test('tokenSizeFor picks the largest size whose level the points reach', () => {
  const sizes = [large, small, medium];
  assert.equal(tokenSizeFor(1, sizes), small);
  assert.equal(tokenSizeFor(4, sizes), small);
  assert.equal(tokenSizeFor(5, sizes), medium);
  assert.equal(tokenSizeFor(19, sizes), medium);
  assert.equal(tokenSizeFor(20, sizes), large);
  assert.equal(tokenSizeFor(500, sizes), large);
});

test('tokenSizeFor gives the smallest size below every level, and nothing when there are no sizes', () => {
  assert.equal(tokenSizeFor(2, [medium, large]), medium);
  assert.equal(tokenSizeFor(0, [medium, large]), medium);
  assert.equal(tokenSizeFor(5, []), null);
});

test('an admin adds, changes and removes a size, naming the tool', async () => {
  const store = await seeded();
  const [first] = await store.list();
  const changed = await changeTokenSize(store, ADMIN, first.id, { ...small, color: '#00ff00' }, TOOL);
  assert.equal(changed.color, '#00ff00');
  assert.equal(changed.tool, TOOL);
  const added = await addTokenSize(store, ADMIN, { name: 'Huge', diameter: 40, color: '#7c3aed', minPoints: 100 }, TOOL);
  assert.equal((await store.list()).length, 4);
  await removeTokenSize(store, ADMIN, added.id, TOOL);
  assert.deepEqual((await store.list()).map((s) => s.name), ['Small', 'Medium', 'Large']);
});

test('a role without Manage game scoring cannot add, change or remove a size', async () => {
  const store = await seeded();
  const [first] = await store.list();
  await assert.rejects(addTokenSize(store, EDITOR, { ...small, minPoints: 2 }, TOOL), /Only an admin can change the token sizes/);
  await assert.rejects(changeTokenSize(store, EDITOR, first.id, { ...small, color: '#000000' }, TOOL), /Only an admin/);
  await assert.rejects(removeTokenSize(store, EDITOR, first.id, TOOL), /Only an admin/);
  await assert.rejects(addTokenSize(store, { role: null }, { ...small, minPoints: 2 }, TOOL), /Only an admin/);
  assert.equal((await store.list()).length, 3);
  // The grants the database holds decide, not the role's name.
  await addTokenSize(store, { role: 'editor', grants: { editor: ['game.edit'] } }, { ...small, minPoints: 2 }, TOOL);
  assert.equal((await store.list()).length, 4);
});

test('two sizes cannot share a point level; a size keeps its own', async () => {
  const store = await seeded();
  await assert.rejects(addTokenSize(store, ADMIN, { name: 'Other', diameter: 16, color: '#000000', minPoints: 5 }, TOOL), /Two sizes cannot share a point level: "Medium" already starts at 5/);
  const [first, second] = await store.list();
  await assert.rejects(changeTokenSize(store, ADMIN, first.id, { ...small, minPoints: 5 }, TOOL), /cannot share a point level/);
  const kept = await changeTokenSize(store, ADMIN, second.id, { ...medium, diameter: 22 }, TOOL);
  assert.equal(kept.diameter, 22);
});

test('a write that fails says so', async () => {
  const store = await seeded();
  const [first] = await store.list();
  store.failNextWrite = true;
  await assert.rejects(addTokenSize(store, ADMIN, { ...small, minPoints: 2 }, TOOL), /did not save/);
  store.failNextWrite = true;
  await assert.rejects(changeTokenSize(store, ADMIN, first.id, { ...small, color: '#000000' }, TOOL), /did not save/);
  store.failNextWrite = true;
  await assert.rejects(removeTokenSize(store, ADMIN, first.id, TOOL), /was not removed/);
  await assert.rejects(changeTokenSize(store, ADMIN, 'gone', small, TOOL), /not there any more/);
  assert.equal((await store.list())[0].color, small.color);
});

test('every change names its tool', async () => {
  const store = await seeded();
  await assert.rejects(addTokenSize(store, ADMIN, { ...small, minPoints: 2 }, ' '), /tool/i);
});

test('adding a token size records one engagement for the admin who added it, naming the tool; a refused or failed one, a change, a removal or a service-key write records none', async () => {
  const ledger = new MemoryEngagementStore();
  const store = new MemoryTokenStore(ledger);
  const added = () => ledger.rows.filter((e) => e.kind === 'added_a_token_size');
  const worth = (await ledger.rules()).find((r) => r.kind === 'added_a_token_size')!.points;
  assert.equal(worth, 1);

  // A service-key write (nobody signed in) saves and scores nothing.
  await addTokenSize(store, ADMIN, small, TOOL);
  assert.equal(added().length, 0);

  store.signedIn = 'dane';
  const huge = await addTokenSize(store, ADMIN, { name: 'Huge', diameter: 40, color: '#7c3aed', minPoints: 100 }, 'size-tool');
  assert.deepEqual(added().map((e) => [e.memberId, e.points, e.tool, e.taskId]), [['dane', worth, 'size-tool', null]]);

  // Changing or removing a size is not this action.
  await changeTokenSize(store, ADMIN, huge.id, { name: 'Huge', diameter: 44, color: '#7c3aed', minPoints: 100 }, TOOL);
  await removeTokenSize(store, ADMIN, huge.id, TOOL);
  assert.equal(added().length, 1);

  // Refused or failed: nothing is recorded.
  store.signedIn = 'vee';
  await assert.rejects(addTokenSize(store, EDITOR, medium, TOOL), /Only an admin/);
  store.signedIn = 'dane';
  await assert.rejects(addTokenSize(store, ADMIN, { ...medium, minPoints: 1 }, TOOL), /cannot share a point level/);
  await assert.rejects(addTokenSize(store, ADMIN, { ...medium, diameter: 99 }, TOOL), /whole number of pixels/);
  store.failNextWrite = true;
  await assert.rejects(addTokenSize(store, ADMIN, medium, TOOL), /did not save/);
  assert.equal(added().length, 1);

  // If the engagement cannot be written, the size is not saved either.
  ledger.failInsert = true;
  await assert.rejects(addTokenSize(store, ADMIN, medium, TOOL), /ledger is down/);
  ledger.failInsert = false;
  assert.deepEqual((await store.list()).map((s) => s.name), ['Small']);
  assert.equal(added().length, 1);

  // Each size added is one more.
  await addTokenSize(store, ADMIN, medium, TOOL);
  await addTokenSize(store, ADMIN, large, TOOL);
  assert.equal(added().length, 3);
});

test('the database scores a new token size only for the signed-in member who added it', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261123230000_score_added_a_token_size.sql', import.meta.url), 'utf8');
  assert.match(sql, /if new\.updated_by is not null and new\.updated_by = auth\.uid\(\) then\s+perform public\.record_engagement\(new\.updated_by, 'added_a_token_size', new\.tool, null\);/);
  assert.match(sql, /create trigger token_sizes_score\s+after insert on public\.token_sizes\s+for each row/);
  assert.match(sql, /revoke execute on function public\.token_sizes_score\(\) from public, anon, authenticated/);
});

test('changing a token size records one engagement for the admin who changed it, naming the tool; a save that changes nothing, a refused or failed one, an add, a removal or a service-key write records none', async () => {
  const ledger = new MemoryEngagementStore();
  const store = new MemoryTokenStore(ledger);
  const changed = () => ledger.rows.filter((e) => e.kind === 'changed_a_token_size');
  const worth = (await ledger.rules()).find((r) => r.kind === 'changed_a_token_size')!.points;
  assert.equal(worth, 1);

  // A service-key write (nobody signed in) saves and scores nothing.
  const s = await addTokenSize(store, ADMIN, small, TOOL);
  const m = await addTokenSize(store, ADMIN, medium, TOOL);
  await changeTokenSize(store, ADMIN, s.id, { ...small, diameter: 15 }, TOOL);
  assert.equal(changed().length, 0);

  // Adding a size is not this action.
  store.signedIn = 'dane';
  const l = await addTokenSize(store, ADMIN, large, TOOL);
  assert.equal(changed().length, 0);

  await changeTokenSize(store, ADMIN, s.id, { ...small, diameter: 16 }, 'size-tool');
  assert.deepEqual(changed().map((e) => [e.memberId, e.points, e.tool, e.taskId]), [['dane', worth, 'size-tool', null]]);

  // A save that changes nothing (only the tool differs) is not counted.
  await changeTokenSize(store, ADMIN, s.id, { ...small, diameter: 16 }, 'another-tool');
  assert.equal(changed().length, 1);

  // Each field counts: name, size, colour, point level.
  await changeTokenSize(store, ADMIN, m.id, { ...medium, name: 'Mid' }, TOOL);
  await changeTokenSize(store, ADMIN, m.id, { ...medium, name: 'Mid', color: '#000000' }, TOOL);
  await changeTokenSize(store, ADMIN, m.id, { ...medium, name: 'Mid', color: '#000000', minPoints: 6 }, TOOL);
  assert.equal(changed().length, 4);

  // Refused or failed: nothing is recorded.
  store.signedIn = 'vee';
  await assert.rejects(changeTokenSize(store, EDITOR, l.id, { ...large, diameter: 30 }, TOOL), /Only an admin/);
  store.signedIn = 'dane';
  await assert.rejects(changeTokenSize(store, ADMIN, l.id, { ...large, minPoints: 6 }, TOOL), /cannot share a point level/);
  await assert.rejects(changeTokenSize(store, ADMIN, l.id, { ...large, diameter: 99 }, TOOL), /whole number of pixels/);
  await assert.rejects(changeTokenSize(store, ADMIN, 'size-gone', large, TOOL), /not there any more/);
  store.failNextWrite = true;
  await assert.rejects(changeTokenSize(store, ADMIN, l.id, { ...large, diameter: 30 }, TOOL), /did not save/);
  assert.equal(changed().length, 4);

  // If the engagement cannot be written, the change is not saved either.
  ledger.failInsert = true;
  await assert.rejects(changeTokenSize(store, ADMIN, l.id, { ...large, diameter: 30 }, TOOL), /ledger is down/);
  ledger.failInsert = false;
  assert.equal(store.rows.get(l.id)?.diameter, large.diameter);
  assert.equal(changed().length, 4);

  // Removing a size is not this action.
  await removeTokenSize(store, ADMIN, l.id, TOOL);
  assert.equal(changed().length, 4);
});

test('the database scores a token size change only for the signed-in member who made it, and only when a field changed', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124010000_score_changed_a_token_size.sql', import.meta.url), 'utf8');
  assert.match(sql, /if new\.updated_by is not null and new\.updated_by = auth\.uid\(\) then\s+perform public\.record_engagement\(new\.updated_by, 'changed_a_token_size', new\.tool, null\);/);
  assert.match(sql, /create trigger token_sizes_score_changed\s+after update of name, diameter, color, min_points on public\.token_sizes\s+for each row\s+when \(\(old\.name, old\.diameter, old\.color, old\.min_points\) is distinct from \(new\.name, new\.diameter, new\.color, new\.min_points\)\)/);
  assert.match(sql, /revoke execute on function public\.token_sizes_score_changed\(\) from public, anon, authenticated/);
});

test('deleting a token size records one engagement for the admin who deleted it, naming the tool; a refused or failed one, an add, a change or a service-key delete records none', async () => {
  const ledger = new MemoryEngagementStore();
  const store = new MemoryTokenStore(ledger);
  const deleted = () => ledger.rows.filter((e) => e.kind === 'deleted_a_token_size');
  const worth = (await ledger.rules()).find((r) => r.kind === 'deleted_a_token_size')!.points;
  assert.equal(worth, 1);

  // A service-key delete (nobody signed in) removes the size and scores nothing.
  const s = await addTokenSize(store, ADMIN, small, TOOL);
  const m = await addTokenSize(store, ADMIN, medium, TOOL);
  await removeTokenSize(store, ADMIN, s.id, TOOL);
  assert.equal(store.rows.has(s.id), false);
  assert.equal(deleted().length, 0);

  // Adding a size and changing one are not this action.
  store.signedIn = 'dane';
  const l = await addTokenSize(store, ADMIN, large, TOOL);
  await changeTokenSize(store, ADMIN, l.id, { ...large, diameter: 30 }, TOOL);
  assert.equal(deleted().length, 0);

  await removeTokenSize(store, ADMIN, m.id, 'size-tool');
  assert.deepEqual(deleted().map((e) => [e.memberId, e.points, e.tool, e.taskId]), [['dane', worth, 'size-tool', null]]);

  // Refused or failed: nothing is recorded, and the size stays.
  store.signedIn = 'vee';
  await assert.rejects(removeTokenSize(store, EDITOR, l.id, TOOL), /Only an admin/);
  store.signedIn = 'dane';
  await assert.rejects(removeTokenSize(store, ADMIN, l.id, ' '), /tool/i);
  await assert.rejects(removeTokenSize(store, ADMIN, m.id, TOOL), /was not removed/);
  store.failNextWrite = true;
  await assert.rejects(removeTokenSize(store, ADMIN, l.id, TOOL), /was not removed/);
  assert.equal(store.rows.has(l.id), true);
  assert.equal(deleted().length, 1);

  // If the engagement cannot be written, the size is not deleted either.
  ledger.failInsert = true;
  await assert.rejects(removeTokenSize(store, ADMIN, l.id, TOOL), /ledger is down/);
  ledger.failInsert = false;
  assert.equal(store.rows.has(l.id), true);
  assert.equal(deleted().length, 1);

  await removeTokenSize(store, ADMIN, l.id, TOOL);
  assert.equal(deleted().length, 2);
});

test('the database scores a token size delete only for the signed-in member who made it, naming the delete’s own tool', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124020000_score_deleted_a_token_size.sql', import.meta.url), 'utf8');
  assert.match(sql, /v_member uuid := auth\.uid\(\);/);
  assert.match(sql, /if v_member is not null then\s+perform public\.record_engagement\(v_member, 'deleted_a_token_size', public\.engagement_tool\(old\.tool\), null\);/);
  assert.match(sql, /create trigger token_sizes_score_delete\s+after delete on public\.token_sizes\s+for each row\s+execute function public\.token_sizes_score_delete\(\);/);
  assert.match(sql, /revoke execute on function public\.token_sizes_score_delete\(\) from public, anon, authenticated/);
});

test('the migration turns on row-level security and checks the same limits core does', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261103150000_token_settings.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.token_sizes enable row level security/);
  assert.match(sql, new RegExp(`check \\(diameter between ${TOKEN_DIAMETER_MIN} and ${TOKEN_DIAMETER_MAX}\\)`));
  assert.match(sql, new RegExp(`between 1 and ${TOKEN_NAME_MAX}\\)`));
  assert.match(sql, /min_points integer\s+not null unique check \(min_points >= 1\)/);
  assert.match(sql, /color ~ '\^#\[0-9a-f\]\{6\}\$'/);
  for (const what of ['add', 'change', 'remove']) assert.match(sql, new RegExp(`manage game scoring can ${what}" on public\\.token_sizes[\\s\\S]*?private\\.may\\('game\\.edit'\\)`));
  // The seeded sizes pass core's own checks.
  const seeds = [...sql.matchAll(/\('(\w+)',\s*(\d+), '(#[0-9a-f]{6})',\s*(\d+)\)/g)];
  assert.equal(seeds.length, 3);
  for (const [, name, diameter, color, minPoints] of seeds) checkTokenSize({ name, diameter, color, minPoints });
});

const at = (minute: number) => `2026-11-03T18:${String(minute).padStart(2, '0')}:00.000+00:00`;
const earning = (id: string, points: number, minute: number): Earning => ({ id, points, createdAt: at(minute) });

test('tokensToPlay plays nothing on a first visit and remembers the newest', () => {
  const recent = [earning('b', 3, 2), earning('a', 1, 1)];
  assert.deepEqual(tokensToPlay(recent, null), { plays: [], newest: { id: 'b', createdAt: at(2) } });
});

test('tokensToPlay plays each earning since the seen one, oldest first, and skips 0 points', () => {
  const recent = [earning('d', 5, 4), earning('c', 0, 3), earning('b', 2, 2), earning('a', 1, 1)];
  const { plays, newest } = tokensToPlay(recent, { id: 'a', createdAt: at(1) });
  assert.deepEqual(plays, [2, 5]);
  assert.deepEqual(newest, { id: 'd', createdAt: at(4) });
  // Reloading with the new mark plays nothing more.
  assert.deepEqual(tokensToPlay(recent, newest!).plays, []);
});

test('tokensToPlay orders earnings from one save by id, so a shared time is not lost or replayed', () => {
  const recent = [earning('y', 2, 1), earning('x', 1, 1), earning('z', 4, 1)];
  assert.deepEqual(tokensToPlay(recent, { id: 'x', createdAt: at(1) }).plays, [2, 4]);
});

test('tokensToPlay caps the tokens and plays the rest as one last token', () => {
  const recent = Array.from({ length: 8 }, (_, i) => earning(`e${i}`, i + 1, i + 1));
  const { plays } = tokensToPlay(recent, { id: 'old', createdAt: at(0) }, 5);
  assert.deepEqual(plays, [1, 2, 3, 4, 5 + 6 + 7 + 8]);
});

test('tokensToPlay keeps the seen mark when there are no earnings at all', () => {
  const seen = { id: 'a', createdAt: at(1) };
  assert.deepEqual(tokensToPlay([], seen), { plays: [], newest: seen });
  assert.deepEqual(tokensToPlay([], null), { plays: [], newest: null });
});
