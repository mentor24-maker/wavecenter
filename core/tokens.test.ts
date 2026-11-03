import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameActor } from './game.ts';
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
