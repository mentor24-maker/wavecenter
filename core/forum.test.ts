import test from 'node:test';
import assert from 'node:assert/strict';
import { addForumEntry, FORUM_NAME_MAX } from './forum.ts';
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
