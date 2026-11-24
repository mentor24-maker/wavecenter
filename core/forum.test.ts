import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addForumEntry, deleteTag, deleteTopic, editTag, editTopic, findForumEntryByName, FORUM_NAME_MAX, mayChangeTag, mayChangeTopic, possibleParents,
  possibleSubTopics, setTopicParent, subTopicsOf, topicSlug, uniqueTopicSlug, type ForumEntry, type ForumTopic,
} from './forum.ts';
import { MemoryForumStore } from './memoryForumStore.ts';

test('addForumEntry adds a topic and a tag, trimmed, in the member’s name, naming the tool', async () => {
  const store = new MemoryForumStore('dane');
  const topic = await addForumEntry(store, 'topic', '  Voting rules ', 'wavecenter');
  const tag = await addForumEntry(store, 'tag', 'governance', 'wavecenter');
  assert.deepEqual([topic.kind, topic.name, topic.createdBy, topic.tool], ['topic', 'Voting rules', 'dane', 'wavecenter']);
  assert.deepEqual([tag.kind, tag.name, tag.createdBy], ['tag', 'governance', 'dane']);
  assert.equal(store.rows.length, 2);
});

test('addForumEntry refuses a blank or over-long name, a missing tool and an unknown kind', async () => {
  const store = new MemoryForumStore();
  await assert.rejects(addForumEntry(store, 'topic', '   ', 'wavecenter'), /A topic needs a name/);
  await assert.rejects(addForumEntry(store, 'tag', undefined, 'wavecenter'), /A tag needs a name/);
  await assert.rejects(addForumEntry(store, 'topic', 'x'.repeat(FORUM_NAME_MAX + 1), 'wavecenter'), /at most 80 characters; this one has 81/);
  await assert.rejects(addForumEntry(store, 'topic', 'Fine', ''), /must name the tool/);
  await assert.rejects(addForumEntry(store, 'thread' as never, 'Fine', 'wavecenter'), /is a topic or a tag/);
  assert.equal(store.rows.length, 0);
  const longest = await addForumEntry(store, 'topic', 'x'.repeat(FORUM_NAME_MAX), 'wavecenter');
  assert.equal(longest.name.length, FORUM_NAME_MAX);
});

test('a name already on the list is refused, whoever added it and whatever its capitals', async () => {
  const rows: never[] = [];
  const dane = new MemoryForumStore('dane', rows);
  const other = new MemoryForumStore('other', rows);
  await addForumEntry(dane, 'topic', 'Voting', 'wavecenter');
  await assert.rejects(addForumEntry(other, 'topic', ' voting ', 'wavecenter'), /already a topic called "Voting"/);
  // A topic and a tag may share a name: they are separate lists.
  const tag = await addForumEntry(other, 'tag', 'Voting', 'wavecenter');
  assert.equal(tag.createdBy, 'other');
  assert.equal(rows.length, 2);
});

test('no character in a name is a wildcard: "Q*", "100%" and "a_b" are their own names', async () => {
  const entry = (name: string): ForumEntry => ({ id: name, kind: 'topic', name, createdBy: null, tool: 'wavecenter', createdAt: '' });
  const list = [entry('Quorum'), entry('1000'), entry('axb'), entry('a\\b')];
  for (const name of ['Q*', 'Q%', '100%', '100_', 'a_b', 'a*b', '*', '%', '_']) {
    assert.equal(findForumEntryByName(list, name), null, `"${name}" matched something`);
  }
  assert.equal(findForumEntryByName(list, ' QUORUM ')?.name, 'Quorum');
  assert.equal(findForumEntryByName(list, 'A\\B')?.name, 'a\\b');

  const store = new MemoryForumStore('dane');
  await addForumEntry(store, 'topic', 'Quorum', 'wavecenter');
  const star = await addForumEntry(store, 'topic', 'Q*', 'wavecenter');
  assert.equal(star.name, 'Q*');
  await assert.rejects(addForumEntry(store, 'topic', 'q*', 'wavecenter'), /already a topic called "Q\*"/);
});

// --- WC-183: a topic's details, changing it and deleting it ----------------

const DANE = { memberId: 'dane', isAdmin: false };
const OTHER = { memberId: 'other', isAdmin: false };
const ADMIN = { memberId: 'boss', isAdmin: true };

async function forum() {
  const rows: never[] = [];
  const dane = new MemoryForumStore('dane', rows);
  const other = new MemoryForumStore('other', rows);
  const voting = await addForumEntry(dane, 'topic', 'Voting rules', 'wavecenter');
  const quorum = await addForumEntry(dane, 'topic', 'Quorum', 'wavecenter');
  const budget = await addForumEntry(other, 'topic', 'Budget', 'wavecenter');
  return { rows: rows as ForumTopic[], dane, other, voting, quorum, budget };
}
const edit = (name: string, more: Record<string, unknown> = {}) => ({ name, slug: '', description: '', details: '', parentId: null, ...more });

test('a slug is made from the name: lower case, hyphens, never blank, made unique', async () => {
  assert.equal(topicSlug('  Voting Rules!  2026 '), 'voting-rules-2026');
  assert.equal(topicSlug('Café & co'), 'caf-co');
  assert.equal(topicSlug('***'), 'topic');
  assert.equal(topicSlug('x'.repeat(100)).length, 80);
  assert.equal(uniqueTopicSlug('voting', ['voting', 'voting-2']), 'voting-3');
  assert.equal(uniqueTopicSlug('x'.repeat(80), ['x'.repeat(80)]), `${'x'.repeat(78)}-2`);
  const { rows } = await forum();
  assert.deepEqual(rows.map((t) => t.slug), ['voting-rules', 'quorum', 'budget']);
  assert.deepEqual([rows[0].description, rows[0].details, rows[0].parentId], ['', '', null]);
});

test('editTopic changes the name, slug, description, details and parent, trimmed', async () => {
  const { dane, voting, quorum } = await forum();
  const saved = await editTopic(dane, quorum.id, edit(' Quorum size ', { slug: 'quorum-size', description: ' How many must vote ', details: '**Bold** words\n- one', parentId: voting.id }), DANE, 'wavecenter');
  assert.deepEqual([saved.name, saved.slug, saved.description, saved.details, saved.parentId], ['Quorum size', 'quorum-size', 'How many must vote', '**Bold** words\n- one', voting.id]);
  const blankSlug = await editTopic(dane, quorum.id, edit('Quorum Rules'), DANE, 'wavecenter');
  assert.equal(blankSlug.slug, 'quorum-rules');
  assert.equal(blankSlug.parentId, null);
});

test('only the topic’s adder or an admin may change or delete it', async () => {
  const { dane, other, voting, budget } = await forum();
  assert.equal(mayChangeTopic(voting, DANE), true);
  assert.equal(mayChangeTopic(voting, OTHER), false);
  assert.equal(mayChangeTopic(voting, ADMIN), true);
  assert.equal(mayChangeTopic({ createdBy: null }, { memberId: '', isAdmin: false }), false);
  await assert.rejects(editTopic(other, voting.id, edit('Mine now'), OTHER, 'wavecenter'), /Only the member who added "Voting rules", or an admin, can change it/);
  await assert.rejects(deleteTopic(other, voting.id, OTHER, 'wavecenter'), /can delete it/);
  const byAdmin = await editTopic(other, voting.id, edit('Voting'), ADMIN, 'wavecenter');
  assert.equal(byAdmin.name, 'Voting');
  await deleteTopic(dane, budget.id, ADMIN, 'wavecenter');
  assert.equal((await dane.listTopics()).some((t) => t.id === budget.id), false);
});

test('a duplicate name or slug, a badly formed slug and over-long words are refused in plain words', async () => {
  const { dane, voting, quorum } = await forum();
  await assert.rejects(editTopic(dane, quorum.id, edit(' VOTING RULES '), DANE, 'wavecenter'), /already a topic called "Voting rules"/);
  await assert.rejects(editTopic(dane, quorum.id, edit('Quorum', { slug: 'voting-rules' }), DANE, 'wavecenter'), /slug "voting-rules" is already used by the topic "Voting rules"/);
  for (const slug of ['Has Caps', 'two--hyphens', '-start', 'end-', 'under_score', 'q*']) {
    await assert.rejects(editTopic(dane, quorum.id, edit('Quorum', { slug }), DANE, 'wavecenter'), /cannot be a slug/, slug);
  }
  await assert.rejects(editTopic(dane, quorum.id, edit('Quorum', { description: 'x'.repeat(501) }), DANE, 'wavecenter'), /at most 500 characters/);
  await assert.rejects(editTopic(dane, quorum.id, edit('Quorum', { description: 'one\ntwo' }), DANE, 'wavecenter'), /description is one line/);
  await assert.rejects(editTopic(dane, quorum.id, edit('Quorum', { details: 'x'.repeat(10001) }), DANE, 'wavecenter'), /at most 10,000 characters/);
  await assert.rejects(editTopic(dane, quorum.id, edit('  '), DANE, 'wavecenter'), /A topic needs a name/);
  await assert.rejects(editTopic(dane, 'nope', edit('Quorum'), DANE, 'wavecenter'), /topic was not found/);
  await assert.rejects(editTopic(dane, quorum.id, edit('Quorum'), DANE, ''), /must name the tool/);
  // Its own name and slug are fine to keep.
  assert.equal((await editTopic(dane, voting.id, edit('Voting rules', { slug: 'voting-rules' }), DANE, 'wavecenter')).slug, 'voting-rules');
});

test('a parent that is missing, the topic itself or one of its own sub-topics is refused', async () => {
  const { dane, voting, quorum } = await forum();
  const sub = await addForumEntry(dane, 'topic', 'Quorum size', 'wavecenter');
  await editTopic(dane, quorum.id, edit('Quorum', { parentId: voting.id }), DANE, 'wavecenter');
  await editTopic(dane, sub.id, edit('Quorum size', { parentId: quorum.id }), DANE, 'wavecenter');
  await assert.rejects(editTopic(dane, voting.id, edit('Voting rules', { parentId: voting.id }), DANE, 'wavecenter'), /cannot be its own parent/);
  await assert.rejects(editTopic(dane, voting.id, edit('Voting rules', { parentId: quorum.id }), DANE, 'wavecenter'), /"Quorum" is already under "Voting rules"/);
  await assert.rejects(editTopic(dane, voting.id, edit('Voting rules', { parentId: sub.id }), DANE, 'wavecenter'), /"Quorum size" is already under "Voting rules"/);
  await assert.rejects(editTopic(dane, voting.id, edit('Voting rules', { parentId: 'gone' }), DANE, 'wavecenter'), /parent topic was not found/);
  const all = await dane.listTopics();
  assert.deepEqual(possibleParents(all, voting.id).map((t) => t.name), ['Budget']);
  assert.deepEqual(possibleParents(all, sub.id).map((t) => t.name).sort(), ['Budget', 'Quorum', 'Voting rules']);
});

test('deleting a topic keeps its sub-topics, with no parent', async () => {
  const { dane, voting, quorum } = await forum();
  await editTopic(dane, quorum.id, edit('Quorum', { parentId: voting.id }), DANE, 'wavecenter');
  await deleteTopic(dane, voting.id, DANE, 'wavecenter');
  const left = await dane.listTopics();
  assert.deepEqual(left.map((t) => [t.name, t.parentId]), [['Quorum', null], ['Budget', null]]);
  await assert.rejects(deleteTopic(dane, voting.id, DANE, 'wavecenter'), /topic was not found/);
});

test('setTopicParent sets and clears only the parent, keeping every other field', async () => {
  const { dane, voting, quorum } = await forum();
  await editTopic(dane, quorum.id, edit('Quorum', { slug: 'q', description: 'How many', details: 'Words' }), DANE, 'wavecenter');
  const under = await setTopicParent(dane, quorum.id, voting.id, DANE, 'wavecenter');
  assert.deepEqual([under.parentId, under.name, under.slug, under.description, under.details], [voting.id, 'Quorum', 'q', 'How many', 'Words']);
  assert.deepEqual(subTopicsOf(await dane.listTopics(), voting.id).map((t) => t.name), ['Quorum']);
  for (const none of [null, '', undefined]) {
    assert.equal((await setTopicParent(dane, quorum.id, none, DANE, 'wavecenter')).parentId, null);
  }
  assert.deepEqual(subTopicsOf(await dane.listTopics(), voting.id), []);
});

test('adopting a sub-topic is setTopicParent with the chosen topic moved under this one', async () => {
  const { dane, other, voting, budget } = await forum();
  // Budget was added by another member: only they or an admin may move it.
  await assert.rejects(setTopicParent(dane, budget.id, voting.id, DANE, 'wavecenter'), /Only the member who added "Budget", or an admin, can move it/);
  assert.equal((await setTopicParent(other, budget.id, voting.id, OTHER, 'wavecenter')).parentId, voting.id);
  assert.equal((await setTopicParent(dane, budget.id, null, ADMIN, 'wavecenter')).parentId, null);
});

test('setTopicParent refuses itself, a loop at any depth, a missing topic or parent, and no tool', async () => {
  const { dane, voting, quorum } = await forum();
  const sub = await addForumEntry(dane, 'topic', 'Quorum size', 'wavecenter');
  await setTopicParent(dane, quorum.id, voting.id, DANE, 'wavecenter');
  await setTopicParent(dane, sub.id, quorum.id, DANE, 'wavecenter');
  await assert.rejects(setTopicParent(dane, voting.id, voting.id, DANE, 'wavecenter'), /cannot be its own parent/);
  await assert.rejects(setTopicParent(dane, voting.id, sub.id, DANE, 'wavecenter'), /"Quorum size" is already under "Voting rules"/);
  await assert.rejects(setTopicParent(dane, 'gone', voting.id, DANE, 'wavecenter'), /topic was not found/);
  await assert.rejects(setTopicParent(dane, voting.id, 'gone', DANE, 'wavecenter'), /parent topic was not found/);
  await assert.rejects(setTopicParent(dane, voting.id, null, DANE, ''), /must name the tool/);
  assert.equal((await dane.listTopics()).find((t) => t.id === voting.id)?.parentId, null);
});

test('possibleSubTopics leaves out the topic itself, its direct sub-topics and everything above it', async () => {
  const { dane, voting, quorum } = await forum();
  const sub = await addForumEntry(dane, 'topic', 'Quorum size', 'wavecenter');
  await setTopicParent(dane, quorum.id, voting.id, DANE, 'wavecenter');
  await setTopicParent(dane, sub.id, quorum.id, DANE, 'wavecenter');
  const all = await dane.listTopics();
  // Voting may adopt Quorum size (a grandchild, moved up) and Budget, not Quorum (already its child).
  assert.deepEqual(possibleSubTopics(all, voting.id).map((t) => t.name).sort(), ['Budget', 'Quorum size']);
  // Quorum size sits under Quorum under Voting rules, so it may adopt only Budget.
  assert.deepEqual(possibleSubTopics(all, sub.id).map((t) => t.name), ['Budget']);
});

// --- WC-186: a tag's details, related tags, changing it and deleting it ----

async function tags() {
  const rows: never[] = [];
  const relations: [string, string][] = [];
  const dane = new MemoryForumStore('dane', rows, relations);
  const other = new MemoryForumStore('other', rows, relations);
  const voting = await addForumEntry(dane, 'tag', 'Voting', 'wavecenter');
  const budget = await addForumEntry(dane, 'tag', 'Budget', 'wavecenter');
  const roads = await addForumEntry(other, 'tag', 'Roads', 'wavecenter');
  return { relations, dane, other, voting, budget, roads };
}
const tagEdit = (name: string, more: Record<string, unknown> = {}) => ({ name, slug: '', description: '', details: '', relatedIds: [], ...more });
const related = async (store: MemoryForumStore, id: string) => {
  const all = await store.listTags();
  const names = new Map(all.map((t) => [t.id, t.name]));
  return all.find((t) => t.id === id)!.relatedIds.map((r) => names.get(r)).sort();
};

test('a new tag gets a slug from its name ("tag" if nothing is left), blank words and no related tags', async () => {
  const { dane } = await tags();
  await addForumEntry(dane, 'tag', '***', 'wavecenter');
  const all = await dane.listTags();
  assert.deepEqual(all.map((t) => t.slug), ['voting', 'budget', 'roads', 'tag']);
  assert.deepEqual([all[0].description, all[0].details, all[0].relatedIds], ['', '', []]);
  assert.equal(topicSlug('***', 'tag'), 'tag');
});

test('editTag changes the name, slug, description, details and related tags, and a relation shows both ways', async () => {
  const { dane, relations, voting, budget, roads } = await tags();
  const saved = await editTag(dane, voting.id, tagEdit(' Voting rules ', { slug: 'voting-rules', description: ' How we vote ', details: '**Bold**', relatedIds: [budget.id, roads.id] }), DANE, 'wavecenter');
  assert.deepEqual([saved.name, saved.slug, saved.description, saved.details], ['Voting rules', 'voting-rules', 'How we vote', '**Bold**']);
  assert.deepEqual(await related(dane, voting.id), ['Budget', 'Roads']);
  assert.deepEqual(await related(dane, budget.id), ['Voting rules']);
  assert.deepEqual(await related(dane, roads.id), ['Voting rules']);
  assert.equal(relations.length, 2, 'each relation is kept once');
  // Saving Budget with Voting already related from the other side keeps one copy.
  await editTag(dane, budget.id, tagEdit('Budget', { relatedIds: [voting.id, voting.id] }), DANE, 'wavecenter');
  assert.equal(relations.length, 2);
  // Unticking replaces the list: Budget no longer relates to Voting, from either side.
  await editTag(dane, budget.id, tagEdit('Budget', { relatedIds: [] }), DANE, 'wavecenter');
  assert.deepEqual(await related(dane, voting.id), ['Roads']);
  assert.deepEqual(await related(dane, budget.id), []);
  const blankSlug = await editTag(dane, budget.id, tagEdit('Budget Plans'), DANE, 'wavecenter');
  assert.equal(blankSlug.slug, 'budget-plans');
});

test('a tag cannot be related to itself or to a tag that is not there, and nothing is saved', async () => {
  const { dane, voting, budget } = await tags();
  await assert.rejects(editTag(dane, voting.id, tagEdit('Voting', { relatedIds: [voting.id] }), DANE, 'wavecenter'), /cannot be related to itself/);
  await assert.rejects(editTag(dane, voting.id, tagEdit('Voting', { relatedIds: [budget.id, 'gone'] }), DANE, 'wavecenter'), /related tags was not found/);
  await assert.rejects(editTag(dane, voting.id, tagEdit('Voting', { relatedIds: budget.id }), DANE, 'wavecenter'), /must be a list/);
  assert.deepEqual(await related(dane, voting.id), []);
});

test('a duplicate tag name or slug, a bad slug and over-long words are refused in plain words', async () => {
  const { dane, voting, budget } = await tags();
  await assert.rejects(editTag(dane, budget.id, tagEdit(' VOTING '), DANE, 'wavecenter'), /already a tag called "Voting"/);
  await assert.rejects(editTag(dane, budget.id, tagEdit('Budget', { slug: 'voting' }), DANE, 'wavecenter'), /slug "voting" is already used by the tag "Voting"/);
  await assert.rejects(editTag(dane, budget.id, tagEdit('Budget', { slug: 'Not A Slug' }), DANE, 'wavecenter'), /cannot be a slug/);
  await assert.rejects(editTag(dane, budget.id, tagEdit('Budget', { description: 'one\ntwo' }), DANE, 'wavecenter'), /A tag's description is one line/);
  await assert.rejects(editTag(dane, budget.id, tagEdit('Budget', { details: 'x'.repeat(10001) }), DANE, 'wavecenter'), /A tag's details can be at most 10,000/);
  await assert.rejects(editTag(dane, budget.id, tagEdit('  '), DANE, 'wavecenter'), /A tag needs a name/);
  await assert.rejects(editTag(dane, 'nope', tagEdit('Budget'), DANE, 'wavecenter'), /tag was not found/);
  // Its own name and slug are fine to keep, and a tag may share a topic's slug: they are separate lists.
  await addForumEntry(dane, 'topic', 'Voting', 'wavecenter');
  assert.equal((await editTag(dane, voting.id, tagEdit('Voting', { slug: 'voting' }), DANE, 'wavecenter')).slug, 'voting');
});

test('only the tag’s adder or an admin may change or delete it', async () => {
  const { dane, other, voting, roads } = await tags();
  assert.equal(mayChangeTag(voting, DANE), true);
  assert.equal(mayChangeTag(voting, OTHER), false);
  assert.equal(mayChangeTag(voting, ADMIN), true);
  await assert.rejects(editTag(other, voting.id, tagEdit('Mine now'), OTHER, 'wavecenter'), /Only the member who added "Voting", or an admin, can change it/);
  await assert.rejects(deleteTag(other, voting.id, OTHER, 'wavecenter'), /can delete it/);
  assert.equal((await editTag(other, voting.id, tagEdit('Voting', { relatedIds: [roads.id] }), ADMIN, 'wavecenter')).name, 'Voting');
  await deleteTag(dane, roads.id, ADMIN, 'wavecenter');
  assert.equal((await dane.listTags()).some((t) => t.id === roads.id), false);
});

test('deleting a tag takes it off every other tag’s related tags', async () => {
  const { dane, relations, voting, budget } = await tags();
  await editTag(dane, voting.id, tagEdit('Voting', { relatedIds: [budget.id] }), DANE, 'wavecenter');
  await deleteTag(dane, budget.id, DANE, 'wavecenter');
  assert.deepEqual(await related(dane, voting.id), []);
  assert.equal(relations.length, 0);
  await assert.rejects(deleteTag(dane, budget.id, DANE, 'wavecenter'), /tag was not found/);
});
