import test from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, deleteProposal, updateProposal } from './proposals.ts';
import { MemoryProposalStore } from './memoryProposalStore.ts';
import { MemoryEngagementStore } from './memoryEngagementStore.ts';

test('createProposal fills in the defaults and records the owner and the tool', async () => {
  const store = new MemoryProposalStore('dane');
  const proposal = await createProposal(store, { title: '  A voting page ', notes: '   ' }, 'wavecenter');
  assert.equal(proposal.title, 'A voting page');
  assert.equal(proposal.notes, null);
  assert.equal(proposal.status, 'todo');
  assert.equal(proposal.points, 0);
  assert.equal(proposal.priority, 'normal');
  assert.equal(proposal.parentProposalId, null);
  assert.equal(proposal.ownerId, 'dane');
  assert.equal(proposal.tool, 'wavecenter');
});

test('createProposal takes notes, points and a priority', async () => {
  const store = new MemoryProposalStore();
  const proposal = await createProposal(store, { title: 'Badges', notes: ' For streaks ', points: 8, priority: 'high' }, 'wavecenter');
  assert.equal(proposal.notes, 'For streaks');
  assert.equal(proposal.points, 8);
  assert.equal(proposal.priority, 'high');
});

test('createProposal refuses a missing tool, a blank title, a bad status, priority or points', async () => {
  const store = new MemoryProposalStore();
  await assert.rejects(createProposal(store, { title: 'x' }, ''), /must name the tool/);
  await assert.rejects(createProposal(store, { title: '  ' }, 'wavecenter'), /needs a title/);
  await assert.rejects(createProposal(store, { title: 'x', status: 'proposed' as never }, 'wavecenter'), /status must be one of todo, doing, done/);
  await assert.rejects(createProposal(store, { title: 'x', priority: 'soon' as never }, 'wavecenter'), /priority must be one of/);
  await assert.rejects(createProposal(store, { title: 'x', points: -1 }, 'wavecenter'), /can't be negative/);
  await assert.rejects(createProposal(store, { title: 'x', points: 1.5 }, 'wavecenter'), /whole number/);
  assert.equal(store.rows.size, 0);
});

test('updateProposal changes the owner’s own proposal and stamps the tool', async () => {
  const store = new MemoryProposalStore();
  const proposal = await createProposal(store, { title: 'Old' }, 'wavecenter');
  const changed = await updateProposal(store, proposal.id, { title: ' New ', notes: 'why', points: 5, priority: 'low', status: 'done' }, 'planner');
  assert.equal(changed.title, 'New');
  assert.equal(changed.notes, 'why');
  assert.equal(changed.points, 5);
  assert.equal(changed.priority, 'low');
  assert.equal(changed.status, 'done');
  assert.equal(changed.tool, 'planner');
  await assert.rejects(updateProposal(store, proposal.id, { title: '' }, 'wavecenter'), /needs a title/);
  assert.equal(store.rows.get(proposal.id)?.title, 'New');
});

test('a member cannot change or delete another member’s proposal', async () => {
  const a = new MemoryProposalStore('a');
  const b = new MemoryProposalStore('b', a.rows);
  const mine = await createProposal(a, { title: 'A’s idea' }, 'wavecenter');
  await assert.rejects(updateProposal(b, mine.id, { title: 'Hijacked' }, 'wavecenter'), /Only the member who made a proposal can change it/);
  await assert.rejects(deleteProposal(b, mine.id, 'wavecenter'), /Only the member who made a proposal can delete it/);
  assert.equal(a.rows.get(mine.id)?.title, 'A’s idea');
});

test('a sub-proposal goes only under one of the member’s own, and never under itself or its own child', async () => {
  const a = new MemoryProposalStore('a');
  const b = new MemoryProposalStore('b', a.rows);
  const parent = await createProposal(a, { title: 'Parent' }, 'wavecenter');
  const child = await createProposal(a, { title: 'Child', parentProposalId: parent.id }, 'wavecenter');
  assert.equal(child.parentProposalId, parent.id);
  await assert.rejects(createProposal(b, { title: 'B under A', parentProposalId: parent.id }, 'wavecenter'), /you may put a sub-proposal under/);
  await assert.rejects(updateProposal(a, parent.id, { parentProposalId: parent.id }, 'wavecenter'), /its own parent/);
  await assert.rejects(updateProposal(a, parent.id, { parentProposalId: child.id }, 'wavecenter'), /one of its own sub-proposals/);
});

test('deleteProposal removes it and keeps its sub-proposals as top-level', async () => {
  const store = new MemoryProposalStore();
  const parent = await createProposal(store, { title: 'Parent' }, 'wavecenter');
  const child = await createProposal(store, { title: 'Child', parentProposalId: parent.id }, 'wavecenter');
  await assert.rejects(deleteProposal(store, parent.id, ' '), /must name the tool/);
  await deleteProposal(store, parent.id, 'wavecenter');
  assert.equal(store.rows.has(parent.id), false);
  assert.equal(store.rows.get(child.id)?.parentProposalId, null);
  await assert.rejects(deleteProposal(store, parent.id, 'wavecenter'), /No proposal .* you may delete/);
});

test('making a proposal records one engagement for the member who made it, naming the tool; a refused one records none', async () => {
  const ledger = new MemoryEngagementStore();
  const rows = new Map();
  const dane = new MemoryProposalStore('dane', rows, ledger);
  const other = new MemoryProposalStore('other', rows, ledger);
  const scored = () => ledger.rows.filter((e) => e.kind === 'made_a_proposal');
  const worth = (await ledger.rules()).find((r) => r.kind === 'made_a_proposal')?.points;

  const first = await createProposal(dane, { title: 'A voting page' }, 'wavecenter');
  assert.deepEqual(scored().map((e) => [e.memberId, e.tool, e.points, e.taskId ?? null]), [['dane', 'wavecenter', worth, null]]);

  // Changing or deleting a proposal are their own actions, not this one.
  await updateProposal(dane, first.id, { title: 'A voting page, with quorum' }, 'wavecenter');
  // A proposal that is refused saves nothing and scores nothing.
  await assert.rejects(createProposal(other, { title: '  ' }, 'wavecenter'), /needs a title/);
  await assert.rejects(createProposal(other, { title: 'x' }, ''), /must name the tool/);
  assert.equal(scored().length, 1);

  // Credited to whoever made it.
  await createProposal(other, { title: 'Badges' }, 'mcp');
  assert.deepEqual(scored().map((e) => [e.memberId, e.tool]), [['dane', 'wavecenter'], ['other', 'mcp']]);

  // If the engagement cannot be written, the proposal is not saved either.
  ledger.failInsert = true;
  await assert.rejects(createProposal(dane, { title: 'Streaks' }, 'wavecenter'), /ledger is down/);
  ledger.failInsert = false;
  assert.equal(rows.size, 2);
  assert.equal(scored().length, 2);

  await deleteProposal(dane, first.id, 'wavecenter');
  assert.equal(scored().length, 2);
});

test('changing a proposal records one engagement for the member who changed it, naming the tool; a save that changes nothing or is refused records none', async () => {
  const ledger = new MemoryEngagementStore();
  const rows = new Map();
  const dane = new MemoryProposalStore('dane', rows, ledger);
  const other = new MemoryProposalStore('other', rows, ledger);
  const scored = () => ledger.rows.filter((e) => e.kind === 'changed_a_proposal');
  const worth = (await ledger.rules()).find((r) => r.kind === 'changed_a_proposal')?.points;

  // Making a proposal is its own action, not this one.
  const first = await createProposal(dane, { title: 'A voting page' }, 'wavecenter');
  const umbrella = await createProposal(dane, { title: 'Voting' }, 'wavecenter');
  const theirs = await createProposal(other, { title: 'Badges' }, 'wavecenter');
  assert.equal(scored().length, 0);

  await updateProposal(dane, first.id, { title: 'A voting page, with quorum' }, 'wavecenter');
  assert.deepEqual(scored().map((e) => [e.memberId, e.tool, e.points, e.taskId ?? null]), [['dane', 'wavecenter', worth, null]]);

  // Each field the edit form saves counts, and so does a new parent.
  await updateProposal(dane, first.id, { notes: 'Two thirds to pass.' }, 'mcp');
  await updateProposal(dane, first.id, { points: 3, priority: 'high', status: 'doing' }, 'wavecenter');
  await updateProposal(dane, first.id, { parentProposalId: umbrella.id }, 'wavecenter');
  assert.deepEqual(scored().map((e) => [e.memberId, e.tool]), [['dane', 'wavecenter'], ['dane', 'mcp'], ['dane', 'wavecenter'], ['dane', 'wavecenter']]);

  // A save that changes nothing, or only reorders it, records nothing.
  await updateProposal(dane, first.id, { title: 'A voting page, with quorum', points: 3, status: 'doing' }, 'wavecenter');
  await updateProposal(dane, first.id, { position: 5 }, 'wavecenter');
  assert.equal(scored().length, 4);

  // A refused change saves nothing and scores nothing.
  await assert.rejects(updateProposal(dane, first.id, { title: '  ' }, 'wavecenter'), /needs a title/);
  await assert.rejects(updateProposal(dane, first.id, { title: 'x' }, ''), /must name the tool/);
  await assert.rejects(updateProposal(other, first.id, { title: 'Mine now' }, 'wavecenter'), /No proposal .* you may change/);
  assert.equal(scored().length, 4);

  // Credited to whoever changed it.
  await updateProposal(other, theirs.id, { title: 'Badges and streaks' }, 'wavecenter');
  assert.deepEqual(scored().at(-1)?.memberId, 'other');

  // If the engagement cannot be written, the change is not saved either.
  ledger.failInsert = true;
  await assert.rejects(updateProposal(dane, first.id, { title: 'Streaks' }, 'wavecenter'), /ledger is down/);
  ledger.failInsert = false;
  assert.equal(rows.get(first.id)?.title, 'A voting page, with quorum');
  assert.equal(scored().length, 5);

  // Deleting a proposal is its own action too, and a sub-proposal losing its
  // parent that way is not a change its owner made.
  await deleteProposal(dane, umbrella.id, 'wavecenter');
  assert.equal(rows.get(first.id)?.parentProposalId, null);
  assert.equal(scored().length, 5);
});

test('deleting a proposal records one engagement for the member who deleted it, naming the tool; a refused delete records none', async () => {
  const ledger = new MemoryEngagementStore();
  const rows = new Map();
  const dane = new MemoryProposalStore('dane', rows, ledger);
  const other = new MemoryProposalStore('other', rows, ledger);
  const scored = () => ledger.rows.filter((e) => e.kind === 'deleted_a_proposal');
  const worth = (await ledger.rules()).find((r) => r.kind === 'deleted_a_proposal')?.points;

  // Making and changing a proposal are their own actions, not this one.
  const first = await createProposal(dane, { title: 'A voting page' }, 'wavecenter');
  const umbrella = await createProposal(dane, { title: 'Voting' }, 'wavecenter');
  const child = await createProposal(dane, { title: 'Quorum', parentProposalId: umbrella.id }, 'wavecenter');
  const theirs = await createProposal(other, { title: 'Badges' }, 'wavecenter');
  await updateProposal(dane, first.id, { title: 'A voting page, with quorum' }, 'wavecenter');
  assert.equal(scored().length, 0);

  await deleteProposal(dane, first.id, 'mcp');
  assert.deepEqual(scored().map((e) => [e.memberId, e.tool, e.points, e.taskId ?? null]), [['dane', 'mcp', worth, null]]);
  assert.equal(rows.has(first.id), false);

  // Deleting a parent counts once: its sub-proposal stays, and is not deleted.
  await deleteProposal(dane, umbrella.id, 'wavecenter');
  assert.equal(rows.get(child.id)?.parentProposalId, null);
  assert.equal(scored().length, 2);

  // A refused delete deletes nothing and scores nothing.
  await assert.rejects(deleteProposal(other, child.id, 'wavecenter'), /may delete/);
  await assert.rejects(deleteProposal(dane, child.id, ''), /must name the tool/);
  await assert.rejects(deleteProposal(dane, 'no-such-proposal', 'wavecenter'), /may delete/);
  assert.equal(scored().length, 2);
  assert.ok(rows.has(child.id));

  // Credited to whoever deleted it.
  await deleteProposal(other, theirs.id, 'wavecenter');
  assert.equal(scored().at(-1)?.memberId, 'other');

  // If the engagement cannot be written, the proposal is not deleted either.
  ledger.failInsert = true;
  await assert.rejects(deleteProposal(dane, child.id, 'wavecenter'), /ledger is down/);
  ledger.failInsert = false;
  assert.ok(rows.has(child.id));
  assert.equal(scored().length, 3);
});
