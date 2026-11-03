import test from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, deleteProposal, updateProposal } from './proposals.ts';
import { MemoryProposalStore } from './memoryProposalStore.ts';

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
