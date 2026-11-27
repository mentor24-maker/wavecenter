/**
 * The Forum's topics and tags, and the only path for adding one.
 *
 * The Forum is where members collaboratively curate topics, tags and threads
 * to discuss and exchange ideas, aiming at proposals (Dane, 2026-11-04). Its
 * first section (WC-178, 2026-11-15) is two lists side by side: topics on the
 * left, tags on the right, each with its own Add box over a table. A topic
 * and a tag have the same shape: a name, who added it, the tool, and when.
 *
 * Every member reads every topic and tag and may add one. Names are unique
 * without regard to capitals or surrounding spaces. A topic can be opened,
 * changed and deleted, and can have a parent topic (WC-183, below); a tag
 * can too, and has related tags in place of a parent (WC-186, below).
 * A topic can carry tags (WC-249, at the end). Threads come later. Core does not know about Supabase: it talks to a
 * `ForumStore`, a thin adapter a client supplies. The plain-words description
 * of the tables is docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';

/** The two kinds of Forum entry, and their table words. */
export const FORUM_KINDS = ['topic', 'tag'] as const;
export type ForumKind = (typeof FORUM_KINDS)[number];

/** The longest name a topic or tag may have, in characters. */
export const FORUM_NAME_MAX = 80;

/** One row of `forum_topics` or `forum_tags`, in core's own names. */
export interface ForumEntry {
  id: string;
  kind: ForumKind;
  name: string;
  /** The member who added it; null once their account is deleted. */
  createdBy: string | null;
  tool: string;
  createdAt: string;
}

/** The fields a store writes for a new entry. The adder is the signed-in member. */
export interface NewForumEntryRow {
  name: string;
  tool: string;
}

/** What core needs from storage. Every value it writes was decided here. */
export interface ForumStore {
  insert(kind: ForumKind, row: NewForumEntryRow): Promise<ForumEntry>;
  /** The entry of this kind whose name matches, ignoring capitals and surrounding spaces; null if none. */
  findByName(kind: ForumKind, name: string): Promise<ForumEntry | null>;
}

/** The form of a name two entries may not share: no surrounding spaces, no capitals. */
export function forumNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The entry among `entries` whose name matches `name`, ignoring capitals and
 * surrounding spaces; null if none. A plain string comparison, so no
 * character in a name ("*", "%", "_") is ever read as a wildcard.
 */
export function findForumEntryByName(entries: readonly ForumEntry[], name: string): ForumEntry | null {
  const key = forumNameKey(name);
  return entries.find((e) => forumNameKey(e.name) === key) ?? null;
}

function requireKind(kind: unknown): ForumKind {
  if (!FORUM_KINDS.includes(kind as ForumKind)) {
    throw new CoreError(`A Forum entry is a ${FORUM_KINDS.join(' or a ')}; got "${String(kind)}".`);
  }
  return kind as ForumKind;
}

/** The name trimmed, or a plain-words refusal. */
export function requireForumName(kind: ForumKind, name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new CoreError(`A ${kind} needs a name, and it cannot be blank.`);
  }
  const trimmed = name.trim();
  if ([...trimmed].length > FORUM_NAME_MAX) {
    throw new CoreError(`A ${kind}'s name can be at most ${FORUM_NAME_MAX} characters; this one has ${[...trimmed].length}.`);
  }
  return trimmed;
}

/** Add a topic or a tag on behalf of `tool`. Any member may add one; a name already on the list is refused. */
export async function addForumEntry(store: ForumStore, kind: ForumKind, name: unknown, tool: string): Promise<ForumEntry> {
  const k = requireKind(kind);
  const row: NewForumEntryRow = { tool: requireTool(tool), name: requireForumName(k, name) };
  const existing = await store.findByName(k, row.name);
  if (existing) throw new CoreError(`There is already a ${k} called "${existing.name}".`);
  return store.insert(k, row);
}

// ---------------------------------------------------------------------------
// A topic's details, changing it and deleting it (WC-183, 2026-11-22).
//
// A topic also has a slug (its short web-address name), a one-line
// description, rich-text details (core/richText.ts, stored as plain words)
// and a parent topic. Who may change or delete a topic: the member who added
// it, and admins (Dane, 2026-11-22, "A"). Deleting a topic leaves its
// sub-topics in place with no parent. Tags stay as they are.
// ---------------------------------------------------------------------------

/** The longest slug, description and details, in characters. */
export const TOPIC_SLUG_MAX = 80;
export const TOPIC_DESCRIPTION_MAX = 500;
export const TOPIC_DETAILS_MAX = 10000;

/** A topic with everything its details page shows. */
export interface ForumTopic extends ForumEntry {
  kind: 'topic';
  slug: string;
  description: string;
  /** Rich text in the core/richText.ts format: plain words, never HTML. */
  details: string;
  parentId: string | null;
  updatedAt: string;
}

/** The columns an edit writes, every one decided here. */
export interface TopicChangeRow {
  name: string;
  slug: string;
  description: string;
  details: string;
  parentId: string | null;
}

/** What a member types on the edit page. A blank slug means "make one from the name". */
export interface TopicEdit {
  name: unknown;
  slug?: unknown;
  description?: unknown;
  details?: unknown;
  parentId?: unknown;
}

/** Who is asking: their id, and whether they are an admin. */
export interface ForumActor {
  memberId: string;
  isAdmin: boolean;
}

/** What core needs from storage to change and delete topics. */
export interface TopicStore {
  listTopics(): Promise<ForumTopic[]>;
  /** Write the change and return the topic as saved. Throws if nothing was saved. */
  updateTopic(id: string, row: TopicChangeRow): Promise<ForumTopic>;
  /** Write only the topic's parent (null for none) and return the topic as saved. Throws if nothing was saved. */
  setTopicParent(id: string, parentId: string | null): Promise<ForumTopic>;
  /** Delete the topic; its sub-topics keep going with no parent. Throws if nothing was deleted. */
  deleteTopic(id: string): Promise<void>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The slug a name suggests: lower case, every run of anything but a-z and
 * 0-9 turned into one hyphen, no hyphen at either end, at most 80
 * characters; `fallback` ("topic", or "tag" for a tag) if nothing is left.
 * The database's forum_topic_slug_from() and forum_tag_slug_from() make the
 * same one.
 */
export function topicSlug(name: string, fallback = 'topic'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TOPIC_SLUG_MAX)
    .replace(/-+$/, '');
  return slug || fallback;
}

/** `base`, or `base-2`, `base-3`… whichever no slug in `taken` already is. */
export function uniqueTopicSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const slug = `${base.slice(0, TOPIC_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(slug)) return slug;
  }
}

/** May this member change or delete this topic or tag? Its adder, or an admin. */
export function mayChangeTopic(topic: Pick<ForumEntry, 'createdBy'>, actor: ForumActor): boolean {
  return actor.isAdmin || (topic.createdBy !== null && topic.createdBy === actor.memberId);
}

/** The ids of every topic under `id`, at any depth (not `id` itself). */
export function topicDescendants(topics: readonly Pick<ForumTopic, 'id' | 'parentId'>[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of topics) {
    if (t.parentId) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t.id]);
  }
  const found = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (found.has(next) || next === id) continue;
    found.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return found;
}

/** The topics `id` may have as its parent: every other topic that is not under it. */
export function possibleParents<T extends Pick<ForumTopic, 'id' | 'parentId'>>(topics: readonly T[], id: string): T[] {
  const below = topicDescendants(topics, id);
  return topics.filter((t) => t.id !== id && !below.has(t.id));
}

/**
 * The topics this one may adopt as a sub-topic (WC-185): every other topic
 * that is not already directly under it and that it does not itself sit
 * under, at any depth (adopting one of those would make a loop).
 */
export function possibleSubTopics<T extends Pick<ForumTopic, 'id' | 'parentId'>>(topics: readonly T[], id: string): T[] {
  return topics.filter((t) => t.id !== id && t.parentId !== id && !topicDescendants(topics, t.id).has(id));
}

/** The topics directly under `id`, in the order given. */
export function subTopicsOf<T extends Pick<ForumTopic, 'parentId'>>(topics: readonly T[], id: string): T[] {
  return topics.filter((t) => t.parentId === id);
}

function optionalText(kind: ForumKind, value: unknown, what: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new CoreError(`A ${kind}'s ${what} must be words.`);
  const trimmed = value.trim();
  if ([...trimmed].length > max) {
    throw new CoreError(`A ${kind}'s ${what} can be at most ${max.toLocaleString('en-US')} characters; this one has ${[...trimmed].length.toLocaleString('en-US')}.`);
  }
  return trimmed;
}

function requireTopicSlug(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CoreError('A slug must be words.');
  const slug = value.trim();
  if (slug === '') return null;
  if (slug.length > TOPIC_SLUG_MAX) throw new CoreError(`A slug can be at most ${TOPIC_SLUG_MAX} characters; this one has ${slug.length}.`);
  if (!SLUG.test(slug)) {
    throw new CoreError(`"${slug}" cannot be a slug. Use lower-case letters, digits and single hyphens between them, such as "voting-rules".`);
  }
  return slug;
}

/** The name, slug, description and details an edit asks for, checked against the other entries of its kind. */
function requireEntryFields(
  kind: ForumKind,
  edit: { name: unknown; slug?: unknown; description?: unknown; details?: unknown },
  others: readonly (ForumEntry & { slug: string })[],
): { name: string; slug: string; description: string; details: string } {
  const name = requireForumName(kind, edit.name);
  const twin = findForumEntryByName(others, name);
  if (twin) throw new CoreError(`There is already a ${kind} called "${twin.name}".`);

  const typedSlug = requireTopicSlug(edit.slug);
  let slug: string;
  if (typedSlug === null) {
    slug = uniqueTopicSlug(topicSlug(name, kind), others.map((t) => t.slug));
  } else {
    const holder = others.find((t) => t.slug === typedSlug);
    if (holder) throw new CoreError(`The slug "${typedSlug}" is already used by the ${kind} "${holder.name}".`);
    slug = typedSlug;
  }

  const description = optionalText(kind, edit.description, 'description', TOPIC_DESCRIPTION_MAX);
  if (/[\r\n]/.test(description)) throw new CoreError(`A ${kind}'s description is one line; put longer words in its details.`);
  const details = optionalText(kind, edit.details, 'details', TOPIC_DETAILS_MAX);
  return { name, slug, description, details };
}

function findTopic(topics: readonly ForumTopic[], id: unknown): ForumTopic {
  const topic = typeof id === 'string' ? topics.find((t) => t.id === id) : undefined;
  if (!topic) throw new CoreError('That topic was not found. It may have been deleted.');
  return topic;
}

function requireMay(topic: ForumTopic, actor: ForumActor, verb: string): void {
  if (!mayChangeTopic(topic, actor)) {
    throw new CoreError(`Only the member who added "${topic.name}", or an admin, can ${verb} it.`);
  }
}

/**
 * Change a topic's name, slug, description, details and parent on behalf of
 * `tool`. Refuses, in plain words: someone who may not, a name or slug
 * another topic has, a badly formed slug, over-long words, a parent that is
 * not there, and a parent that would make a loop (the topic itself, or one
 * of its own sub-topics at any depth).
 */
export async function editTopic(store: TopicStore, id: string, edit: TopicEdit, actor: ForumActor, tool: string): Promise<ForumTopic> {
  requireTool(tool);
  const topics = await store.listTopics();
  const topic = findTopic(topics, id);
  requireMay(topic, actor, 'change');
  const others = topics.filter((t) => t.id !== topic.id);

  const fields = requireEntryFields('topic', edit, others);

  const parentId = requireParent(topics, topic, edit.parentId);
  return store.updateTopic(topic.id, { ...fields, parentId });
}

/** The parent id to write (null for none), or a plain-words refusal: not there, itself, or a loop. */
function requireParent(topics: readonly ForumTopic[], topic: ForumTopic, parentId: unknown): string | null {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  if (parentId === topic.id) throw new CoreError('A topic cannot be its own parent.');
  const parent = topics.find((t) => t.id === parentId);
  if (!parent) throw new CoreError('The chosen parent topic was not found. It may have been deleted; choose another.');
  if (topicDescendants(topics, topic.id).has(parent.id)) {
    throw new CoreError(`"${parent.name}" is already under "${topic.name}", so it cannot also be its parent.`);
  }
  return parent.id;
}

/**
 * Set or clear one topic's parent and nothing else, on behalf of `tool`
 * (WC-185): the "Parent topic" dropdown on a topic's details page, and its
 * "Adopt a sub-topic" dropdown, which is this same call with the chosen
 * topic as `topicId` and the page's topic as `parentId`. Only the moved
 * topic's adder or an admin may. Refuses, in plain words: a topic that is
 * not there, itself as parent, and a loop at any depth.
 */
export async function setTopicParent(store: TopicStore, topicId: unknown, parentId: unknown, actor: ForumActor, tool: string): Promise<ForumTopic> {
  requireTool(tool);
  const topics = await store.listTopics();
  const topic = findTopic(topics, topicId);
  requireMay(topic, actor, 'move');
  return store.setTopicParent(topic.id, requireParent(topics, topic, parentId));
}

/** Delete a topic on behalf of `tool`. Its sub-topics stay, with no parent. Only its adder or an admin may. */
export async function deleteTopic(store: TopicStore, id: string, actor: ForumActor, tool: string): Promise<void> {
  requireTool(tool);
  const topic = findTopic(await store.listTopics(), id);
  requireMay(topic, actor, 'delete');
  await store.deleteTopic(topic.id);
}

// ---------------------------------------------------------------------------
// A tag's details, its related tags, changing it and deleting it (WC-186,
// 2026-11-22).
//
// A tag has the same fields as a topic (Dane chose "B" on the ticket): a
// slug, a one-line description and rich-text details. In place of a parent
// it has related tags: a two-way list, so relating Voting to Budget shows
// Voting on Budget too. Who may change or delete a tag is the same as for a
// topic: its adder, and admins. Deleting a tag takes it off every other
// tag's related tags.
// ---------------------------------------------------------------------------

/** A tag with everything its page shows. */
export interface ForumTag extends ForumEntry {
  kind: 'tag';
  slug: string;
  description: string;
  /** Rich text in the core/richText.ts format: plain words, never HTML. */
  details: string;
  /** The ids of the tags it is related to, both ways. */
  relatedIds: string[];
  updatedAt: string;
}

/** The columns and relations an edit writes, every one decided here. */
export interface TagChangeRow {
  name: string;
  slug: string;
  description: string;
  details: string;
  /** Every tag it is related to after the save, no repeats, never itself. */
  relatedIds: string[];
}

/** What a member sends from the edit page. A blank slug means "make one from the name". */
export interface TagEdit {
  name: unknown;
  slug?: unknown;
  description?: unknown;
  details?: unknown;
  relatedIds?: unknown;
}

/** What core needs from storage to change and delete tags. */
export interface TagStore {
  listTags(): Promise<ForumTag[]>;
  /** Write the change and the related tags together, and return the tag as saved. Throws if nothing was saved. */
  updateTag(id: string, row: TagChangeRow): Promise<ForumTag>;
  /** Delete the tag and its relations. Throws if nothing was deleted. */
  deleteTag(id: string): Promise<void>;
}

/** May this member change or delete this tag? Its adder, or an admin: the same rule as a topic. */
export const mayChangeTag = mayChangeTopic;

function findTag(tags: readonly ForumTag[], id: unknown): ForumTag {
  const tag = typeof id === 'string' ? tags.find((t) => t.id === id) : undefined;
  if (!tag) throw new CoreError('That tag was not found. It may have been deleted.');
  return tag;
}

function requireMayTag(tag: ForumTag, actor: ForumActor, verb: string): void {
  if (!mayChangeTag(tag, actor)) {
    throw new CoreError(`Only the member who added "${tag.name}", or an admin, can ${verb} it.`);
  }
}

/** The related tags asked for, checked: a list of tags that are there, not this one; a repeat counts once. */
function requireRelated(tag: ForumTag, tags: readonly ForumTag[], value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CoreError('Related tags must be a list of tags.');
  const ids: string[] = [];
  for (const id of value) {
    if (id === tag.id) throw new CoreError('A tag cannot be related to itself.');
    if (typeof id !== 'string' || !tags.some((t) => t.id === id)) {
      throw new CoreError('One of the chosen related tags was not found. It may have been deleted; reload and choose again.');
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Change a tag's name, slug, description, details and related tags on behalf
 * of `tool`. Refuses, in plain words: someone who may not, a name or slug
 * another tag has, a badly formed slug, over-long words, a related tag that
 * is not there, and the tag itself as one of its related tags.
 */
export async function editTag(store: TagStore, id: string, edit: TagEdit, actor: ForumActor, tool: string): Promise<ForumTag> {
  requireTool(tool);
  const tags = await store.listTags();
  const tag = findTag(tags, id);
  requireMayTag(tag, actor, 'change');
  const fields = requireEntryFields('tag', edit, tags.filter((t) => t.id !== tag.id));
  const relatedIds = requireRelated(tag, tags, edit.relatedIds);
  return store.updateTag(tag.id, { ...fields, relatedIds });
}

/** Delete a tag on behalf of `tool`; it leaves every other tag's related tags. Only its adder or an admin may. */
export async function deleteTag(store: TagStore, id: string, actor: ForumActor, tool: string): Promise<void> {
  requireTool(tool);
  const tag = findTag(await store.listTags(), id);
  requireMayTag(tag, actor, 'delete');
  await store.deleteTag(tag.id);
}

// ---------------------------------------------------------------------------
// Tags on a topic (WC-249, 2026-11-26).
//
// A topic can carry tags: one pair per topic and tag, never twice. Tagging a
// topic is changing it, so only the topic's adder or an admin attaches or
// removes a tag (mayChangeTopic). Only an existing tag can be attached; a
// new one is made on the Forum's Tags list first. Deleting the topic or the
// tag removes its pairs.
// ---------------------------------------------------------------------------

/** One topic carrying one tag. */
export interface TopicTagPair {
  topicId: string;
  tagId: string;
}

/** What core needs from storage to attach and remove a topic's tags. */
export interface TopicTagStore {
  listTopics(): Promise<ForumTopic[]>;
  listTags(): Promise<ForumTag[]>;
  /** The ids of the tags this topic carries now. */
  topicTagIds(topicId: string): Promise<string[]>;
  /** Store the pair. Throws if it was not saved. */
  attachTopicTag(topicId: string, tagId: string): Promise<void>;
  /** Remove the pair. Throws if it could not be removed. */
  detachTopicTag(topicId: string, tagId: string): Promise<void>;
}

/** The topic and tag asked for, both there, and the actor allowed to tag the topic; or a plain-words refusal. */
async function requireTopicAndTag(store: TopicTagStore, topicId: unknown, tagId: unknown, actor: ForumActor): Promise<{ topic: ForumTopic; tag: ForumTag }> {
  const topic = findTopic(await store.listTopics(), topicId);
  if (!mayChangeTopic(topic, actor)) {
    throw new CoreError(`Only the member who added "${topic.name}", or an admin, can change its tags.`);
  }
  const tag = findTag(await store.listTags(), tagId);
  return { topic, tag };
}

/**
 * Attach an existing tag to a topic on behalf of `tool`, and return the ids
 * of the tags it carries afterwards. Attaching a tag it already carries
 * changes nothing. Refuses, in plain words: someone who is neither the
 * topic's adder nor an admin, and a topic or tag that is not there.
 */
export async function attachTopicTag(store: TopicTagStore, topicId: unknown, tagId: unknown, actor: ForumActor, tool: string): Promise<string[]> {
  requireTool(tool);
  const { topic, tag } = await requireTopicAndTag(store, topicId, tagId, actor);
  const now = await store.topicTagIds(topic.id);
  if (now.includes(tag.id)) return now;
  await store.attachTopicTag(topic.id, tag.id);
  return store.topicTagIds(topic.id);
}

/**
 * Remove a tag from a topic on behalf of `tool`, and return the ids of the
 * tags it carries afterwards. Removing a tag it does not carry changes
 * nothing. Refuses the same as attachTopicTag.
 */
export async function detachTopicTag(store: TopicTagStore, topicId: unknown, tagId: unknown, actor: ForumActor, tool: string): Promise<string[]> {
  requireTool(tool);
  const { topic, tag } = await requireTopicAndTag(store, topicId, tagId, actor);
  const now = await store.topicTagIds(topic.id);
  if (!now.includes(tag.id)) return now;
  await store.detachTopicTag(topic.id, tag.id);
  return store.topicTagIds(topic.id);
}

/** The entries among `entries` whose ids are in `ids`, A to Z by name. */
export function entriesByName<T extends Pick<ForumEntry, 'id' | 'name'>>(entries: readonly T[], ids: readonly string[]): T[] {
  return entries
    .filter((e) => ids.includes(e.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}
