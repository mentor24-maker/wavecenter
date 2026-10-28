import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AVATARS, BIO_MAX, DEFAULT_MEMBER_PROFILE, DISPLAY_NAME_MAX, PROFILE_VISIBILITIES, loadProfile, saveProfile,
  type MemberProfile, type MemberProfileStore,
} from './profiles.ts';

class MemoryProfiles implements MemberProfileStore {
  row: MemberProfile | null = null;
  async get() { return this.row; }
  async save(profile: MemberProfile) { this.row = { ...profile }; return this.row; }
}

const input = (extra: object = {}) => ({ displayName: 'Dane', avatar: 'sun', bio: 'Builds WaveCenter.', visibility: 'public', ...extra });

test('a member who never saved a profile is completely anonymous', async () => {
  const profile = await loadProfile(new MemoryProfiles());
  assert.deepEqual(profile, DEFAULT_MEMBER_PROFILE);
  assert.equal(profile.visibility, 'anonymous');
  assert.equal(profile.displayName, null);
  assert.equal(profile.bio, null);
});

test('saveProfile saves every field and the tool, and loadProfile reads it back', async () => {
  const store = new MemoryProfiles();
  const saved = await saveProfile(store, input(), 'wavecenter');
  assert.deepEqual(saved, { displayName: 'Dane', avatar: 'sun', bio: 'Builds WaveCenter.', visibility: 'public', tool: 'wavecenter' });
  assert.deepEqual(await loadProfile(store), saved);
});

test('blank name and bio are saved as none, and text is trimmed', async () => {
  const store = new MemoryProfiles();
  const saved = await saveProfile(store, input({ displayName: '   ', bio: '  hi  ' }), 'wavecenter');
  assert.equal(saved.displayName, null);
  assert.equal(saved.bio, 'hi');
});

test('saveProfile refuses what the database would refuse, and saves nothing', async () => {
  const store = new MemoryProfiles();
  await assert.rejects(saveProfile(store, input({ avatar: 'photo.jpg' }), 'wavecenter'), /not one of WaveCenter's avatars/);
  await assert.rejects(saveProfile(store, input({ visibility: 'everyone' }), 'wavecenter'), /not a visibility choice/);
  await assert.rejects(saveProfile(store, input({ displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1) }), 'wavecenter'), /at most 50/);
  await assert.rejects(saveProfile(store, input({ bio: 'x'.repeat(BIO_MAX + 1) }), 'wavecenter'), /at most 280/);
  await assert.rejects(saveProfile(store, input(), ''), /must name the tool/);
  assert.equal(store.row, null);
  await saveProfile(store, input({ displayName: '🌊'.repeat(DISPLAY_NAME_MAX) }), 'wavecenter');
});

test('a save that does not land, or lands differently, says so', async () => {
  const nothing: MemberProfileStore = { get: async () => null, save: async () => null };
  await assert.rejects(saveProfile(nothing, input(), 'wavecenter'), /did not save/);
  const wrong: MemberProfileStore = { get: async () => null, save: async (p) => ({ ...p, visibility: 'anonymous' }) };
  await assert.rejects(saveProfile(wrong, input(), 'wavecenter'), /did not save/);
});

test('the migration allows exactly the avatars, visibilities and lengths core knows', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261028120000_member_profiles.sql', import.meta.url), 'utf8');
  const listed = (column: string) =>
    [...(sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)`))?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed('avatar'), AVATARS.map((a) => a.id));
  assert.deepEqual(listed('visibility'), [...PROFILE_VISIBILITIES]);
  assert.match(sql, new RegExp(`char_length\\(display_name\\) <= ${DISPLAY_NAME_MAX}\\b`));
  assert.match(sql, new RegExp(`char_length\\(bio\\) <= ${BIO_MAX}\\b`));
  assert.match(sql, /alter table public\.member_profiles enable row level security/);
  assert.match(sql, new RegExp(`avatar\\s+text\\s+not null default '${DEFAULT_MEMBER_PROFILE.avatar}'`));
  assert.match(sql, new RegExp(`visibility\\s+text\\s+not null default '${DEFAULT_MEMBER_PROFILE.visibility}'`));
});
