/**
 * A `ForumStore`, `TopicStore` and `TagStore` that keep topics and tags in memory,
 * acting as one member. Core's tests use it so the rules can be checked
 * without a database; like the real tables, it sets the adder for you,
 * stamps the time, refuses a name or slug already on the list, gives a new
 * topic a slug made from its name, and clears the parent of a deleted
 * topic's sub-topics. A tag gets a slug too, and its related tags are kept
 * once per pair and read both ways; deleting a tag drops its relations.
 * Two stores given the same `rows` and `relations` are two members looking
 * at one Forum.
 */
import { CoreError } from './tool.ts';
import {
  findForumEntryByName,
  forumNameKey as key,
  topicSlug,
  uniqueTopicSlug,
  type ForumEntry,
  type ForumKind,
  type ForumStore,
  type ForumTag,
  type ForumTopic,
  type NewForumEntryRow,
  type TagChangeRow,
  type TagStore,
  type TopicChangeRow,
  type TopicStore,
} from './forum.ts';

let next = 1;

const isTopic = (r: ForumEntry): r is ForumTopic => r.kind === 'topic';
/** A stored tag: everything but its related tags, which live in `relations`. */
type StoredTag = Omit<ForumTag, 'relatedIds'>;
const isTag = (r: ForumEntry): r is StoredTag => r.kind === 'tag';

export class MemoryForumStore implements ForumStore, TopicStore, TagStore {
  readonly rows: ForumEntry[];
  /** Each pair of related tags, once, smaller id first, as the table keeps them. */
  readonly relations: [string, string][];
  private readonly memberId: string;

  constructor(memberId = 'member-1', rows: ForumEntry[] = [], relations: [string, string][] = []) {
    this.memberId = memberId;
    this.rows = rows;
    this.relations = relations;
  }

  async insert(kind: ForumKind, row: NewForumEntryRow): Promise<ForumEntry> {
    if (this.rows.some((r) => r.kind === kind && key(r.name) === key(row.name))) {
      throw new CoreError(`There is already a ${kind} called "${row.name}".`);
    }
    const now = new Date().toISOString();
    const base: ForumEntry = { ...row, kind, id: `${kind}-${next++}`, createdBy: this.memberId, createdAt: now };
    const topic = (): ForumTopic => ({
      ...base,
      kind: 'topic',
      slug: uniqueTopicSlug(topicSlug(row.name), this.rows.filter(isTopic).map((t) => t.slug)),
      description: '',
      details: '',
      parentId: null,
      updatedAt: now,
    });
    const tag = (): StoredTag => ({
      ...base,
      kind: 'tag',
      slug: uniqueTopicSlug(topicSlug(row.name, 'tag'), this.rows.filter(isTag).map((t) => t.slug)),
      description: '',
      details: '',
      updatedAt: now,
    });
    const entry: ForumEntry = kind === 'topic' ? topic() : tag();
    this.rows.push(entry);
    return { ...entry };
  }

  async findByName(kind: ForumKind, name: string): Promise<ForumEntry | null> {
    const found = findForumEntryByName(this.rows.filter((r) => r.kind === kind), name);
    return found ? { ...found } : null;
  }

  async listTopics(): Promise<ForumTopic[]> {
    return this.rows.filter(isTopic).map((t) => ({ ...t }));
  }

  async updateTopic(id: string, row: TopicChangeRow): Promise<ForumTopic> {
    const topic = this.rows.filter(isTopic).find((t) => t.id === id);
    if (!topic) throw new CoreError('That topic was not found. It may have been deleted.');
    const others = this.rows.filter(isTopic).filter((t) => t.id !== id);
    if (others.some((t) => key(t.name) === key(row.name))) throw new CoreError(`There is already a topic called "${row.name}".`);
    if (others.some((t) => t.slug === row.slug)) throw new CoreError(`The slug "${row.slug}" is already used by another topic.`);
    Object.assign(topic, row, { updatedAt: new Date().toISOString() });
    return { ...topic };
  }

  async deleteTopic(id: string): Promise<void> {
    const at = this.rows.findIndex((r) => isTopic(r) && r.id === id);
    if (at < 0) throw new CoreError('That topic was not found. It may have been deleted.');
    this.rows.splice(at, 1);
    for (const t of this.rows.filter(isTopic)) if (t.parentId === id) t.parentId = null;
  }

  private related(id: string): string[] {
    return this.relations.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  }

  async listTags(): Promise<ForumTag[]> {
    return this.rows.filter(isTag).map((t) => ({ ...t, relatedIds: this.related(t.id) }));
  }

  async updateTag(id: string, row: TagChangeRow): Promise<ForumTag> {
    const tag = this.rows.filter(isTag).find((t) => t.id === id);
    if (!tag) throw new CoreError('That tag was not found. It may have been deleted.');
    const others = this.rows.filter(isTag).filter((t) => t.id !== id);
    if (others.some((t) => key(t.name) === key(row.name))) throw new CoreError(`There is already a tag called "${row.name}".`);
    if (others.some((t) => t.slug === row.slug)) throw new CoreError(`The slug "${row.slug}" is already used by another tag.`);
    // Like the table's "once" check and foreign keys: checked before anything changes.
    for (const other of row.relatedIds) {
      if (other === id) throw new CoreError('A tag cannot be related to itself.');
      if (!others.some((t) => t.id === other)) throw new CoreError('One of the chosen related tags was not found.');
    }
    const { relatedIds, ...columns } = row;
    Object.assign(tag, columns, { updatedAt: new Date().toISOString() });
    this.dropRelations(id);
    for (const other of new Set(relatedIds)) this.relations.push(other < id ? [other, id] : [id, other]);
    return { ...tag, relatedIds: this.related(id) };
  }

  async deleteTag(id: string): Promise<void> {
    const at = this.rows.findIndex((r) => isTag(r) && r.id === id);
    if (at < 0) throw new CoreError('That tag was not found. It may have been deleted.');
    this.rows.splice(at, 1);
    this.dropRelations(id);
  }

  private dropRelations(id: string): void {
    for (let i = this.relations.length - 1; i >= 0; i--) {
      if (this.relations[i].includes(id)) this.relations.splice(i, 1);
    }
  }
}
