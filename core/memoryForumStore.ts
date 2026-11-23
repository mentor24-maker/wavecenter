/**
 * A `ForumStore` and `TopicStore` that keep topics and tags in memory,
 * acting as one member. Core's tests use it so the rules can be checked
 * without a database; like the real tables, it sets the adder for you,
 * stamps the time, refuses a name or slug already on the list, gives a new
 * topic a slug made from its name, and clears the parent of a deleted
 * topic's sub-topics. Two stores given the same `rows` are two members
 * looking at one Forum.
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
  type ForumTopic,
  type NewForumEntryRow,
  type TopicChangeRow,
  type TopicStore,
} from './forum.ts';

let next = 1;

const isTopic = (r: ForumEntry): r is ForumTopic => r.kind === 'topic';

export class MemoryForumStore implements ForumStore, TopicStore {
  readonly rows: ForumEntry[];
  private readonly memberId: string;

  constructor(memberId = 'member-1', rows: ForumEntry[] = []) {
    this.memberId = memberId;
    this.rows = rows;
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
    const entry: ForumEntry = kind === 'topic' ? topic() : base;
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
}
