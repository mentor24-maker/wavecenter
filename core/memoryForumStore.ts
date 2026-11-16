/**
 * A `ForumStore` that keeps topics and tags in memory, acting as one member.
 * Core's tests use it so the rules can be checked without a database; like
 * the real tables, it sets the adder for you, stamps the time, and refuses a
 * name already on the list. Two stores given the same `rows` are two members
 * looking at one Forum.
 */
import { CoreError } from './tool.ts';
import type { ForumEntry, ForumKind, ForumStore, NewForumEntryRow } from './forum.ts';

let next = 1;

const key = (name: string) => name.trim().toLowerCase();

export class MemoryForumStore implements ForumStore {
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
    const entry: ForumEntry = { ...row, kind, id: `${kind}-${next++}`, createdBy: this.memberId, createdAt: new Date().toISOString() };
    this.rows.push(entry);
    return { ...entry };
  }

  async findByName(kind: ForumKind, name: string): Promise<ForumEntry | null> {
    const found = this.rows.find((r) => r.kind === kind && key(r.name) === key(name));
    return found ? { ...found } : null;
  }
}
