import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AVATARS, BIO_MAX, DEFAULT_MEMBER_PROFILE, DISPLAY_NAME_MAX, PROFILE_VISIBILITIES, cardCredit, isMemberId, loadProfile, saveProfile, shownProfile,
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

test('cardCredit shows the name only for a Public profile, and nothing of a Private one', () => {
  const sun = { displayName: 'Dane', avatar: 'sun' as const };
  assert.deepEqual(cardCredit({ ...sun, visibility: 'public' }), { avatar: '☀️', avatarLabel: 'Sun', name: 'Dane', profileLink: true });
  assert.deepEqual(cardCredit({ ...sun, visibility: 'anonymous' }), { avatar: '☀️', avatarLabel: 'Sun', name: null, profileLink: false });
  assert.deepEqual(cardCredit({ ...sun, visibility: 'private' }), { avatar: null, avatarLabel: null, name: null, profileLink: false });
});

test('cardCredit: a Public profile with no name shows the avatar alone; an unknown avatar shows the neutral one', () => {
  assert.equal(cardCredit({ displayName: '  ', avatar: 'moon', visibility: 'public' }).name, null);
  assert.equal(cardCredit({ displayName: 'X', avatar: 'nope' as never, visibility: 'public' }).avatar, '👤');
});

test('cardCredit links to a profile only where a Public name shows (WC-238)', () => {
  assert.equal(cardCredit({ displayName: 'Dane', avatar: 'wave', visibility: 'public' }).profileLink, true);
  assert.equal(cardCredit({ displayName: ' ', avatar: 'wave', visibility: 'public' }).profileLink, false);
  assert.equal(cardCredit({ displayName: 'Dane', avatar: 'wave', visibility: 'anonymous' }).profileLink, false);
  assert.equal(cardCredit({ displayName: 'Dane', avatar: 'wave', visibility: 'private' }).profileLink, false);
});

test('shownProfile: Public shows avatar, name and bio; Anonymous the avatar alone; nothing for Private or nobody', () => {
  assert.deepEqual(shownProfile({ avatar: 'sun', displayName: 'Dane', bio: ' Builder ' }), { avatar: '☀️', avatarLabel: 'Sun', name: 'Dane', bio: 'Builder' });
  assert.deepEqual(shownProfile({ avatar: 'moon', displayName: null, bio: null }), { avatar: '🌙', avatarLabel: 'Moon', name: null, bio: null });
  assert.equal(shownProfile(null), null);
  assert.equal(shownProfile({ avatar: null, displayName: 'X', bio: 'Y' }), null);
  assert.equal(shownProfile({ avatar: 'nope', displayName: null, bio: null })?.avatar, '👤');
});

test('isMemberId accepts a UUID and nothing else', () => {
  assert.equal(isMemberId('11111111-2222-4333-8444-555555555555'), true);
  for (const bad of ['', 'abc', '../admin', '11111111-2222-4333-8444-55555555555z', null, 5]) assert.equal(isMemberId(bad), false);
});
