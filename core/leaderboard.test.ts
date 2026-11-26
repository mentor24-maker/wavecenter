import test from 'node:test';
import assert from 'node:assert/strict';
import { ANONYMOUS_MEMBER, rankLeaderboard, type LeaderboardEntry } from './leaderboard.ts';

const entry = (over: Partial<LeaderboardEntry>): LeaderboardEntry => ({
  you: false, avatar: 'wave', displayName: null, granular: 0, globular: 0, tasks: 0, ...over,
});

test('no members: an empty board', () => {
  assert.deepEqual(rankLeaderboard([]), []);
});

test('Total is Granular plus Globular, and the board is ranked by it, highest first', () => {
  const rows = rankLeaderboard([
    entry({ displayName: 'Low', granular: 3, globular: 1, tasks: 1 }),
    entry({ displayName: 'High', granular: 10, globular: 20, tasks: 4 }),
    entry({ displayName: 'Mid', granular: 12, globular: 0 }),
  ]);
  assert.deepEqual(rows.map((r) => [r.rank, r.name, r.total]), [[1, 'High', 30], [2, 'Mid', 12], [3, 'Low', 4]]);
  assert.equal(rows[0].tasks, 4);
});

test('Tasks is a count and never adds to the Total', () => {
  const [row] = rankLeaderboard([entry({ granular: 2, globular: 5, tasks: 9 })]);
  assert.equal(row.total, 7);
});

test('a tie shares a rank and the next rank skips past it', () => {
  const rows = rankLeaderboard([
    entry({ displayName: 'D', granular: 1 }),
    entry({ displayName: 'B', granular: 5 }),
    entry({ displayName: 'C', globular: 5 }),
    entry({ displayName: 'A', granular: 9 }),
  ]);
  assert.deepEqual(rows.map((r) => [r.rank, r.name]), [[1, 'A'], [2, 'B'], [2, 'C'], [4, 'D']]);
});

test('within a tie, named members come first by name, anonymous ones after in the order given', () => {
  const rows = rankLeaderboard([
    entry({ avatar: 'sun', granular: 5 }),
    entry({ displayName: 'zed', granular: 5 }),
    entry({ avatar: null, granular: 5 }),
    entry({ displayName: 'Amy', granular: 5 }),
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.avatarSymbol]), [
    ['Amy', '🌊'], ['zed', '🌊'], [ANONYMOUS_MEMBER, '☀️'], [ANONYMOUS_MEMBER, '👤'],
  ]);
  assert.ok(rows.every((r) => r.rank === 1));
});

test('a Public profile shows its name and avatar', () => {
  const [row] = rankLeaderboard([entry({ avatar: 'moon', displayName: ' Dane ' })]);
  assert.deepEqual([row.name, row.named, row.avatarSymbol, row.avatarLabel], ['Dane', true, '🌙', 'Moon']);
});

test('an anonymous profile shows its avatar and never a name', () => {
  const [row] = rankLeaderboard([entry({ avatar: 'leaf', displayName: null })]);
  assert.deepEqual([row.name, row.named, row.avatarSymbol], [ANONYMOUS_MEMBER, false, '🌿']);
});

test('a Private profile shows neither its avatar nor a name, even if a name slipped through', () => {
  const [row] = rankLeaderboard([entry({ avatar: null, displayName: 'Secret' })]);
  assert.deepEqual([row.name, row.named, row.avatarSymbol, row.avatarLabel], [ANONYMOUS_MEMBER, false, '👤', 'Member']);
});

test('the member\'s own row stays marked as theirs', () => {
  const rows = rankLeaderboard([entry({ granular: 1 }), entry({ you: true, granular: 2 })]);
  assert.deepEqual(rows.map((r) => r.you), [true, false]);
});

test('a missing or negative number counts as 0', () => {
  const [row] = rankLeaderboard([entry({ granular: Number.NaN, globular: -4, tasks: -1 })]);
  assert.deepEqual([row.granular, row.globular, row.tasks, row.total], [0, 0, 0, 0]);
});
