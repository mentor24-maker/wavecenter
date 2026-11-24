/**
 * How the Forum's Tags table is filtered and sorted in the browser, on the
 * tags the page already loaded: nothing here reads or writes the database.
 * The tag twin of topicView.ts (WC-186): the same click-to-sort headings and
 * live text filter, with a Related Tags column in place of Parent.
 */

/** One row of the Tags table. */
export interface ViewTag {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** The tags it is related to, A to Z (both ways), for the Related Tags column. */
  related: { id: string; name: string }[];
  /** Who added it, as the table shows it ("you", a name, "a former member"). */
  by: string;
  createdAt: string;
  /** May the viewer change and delete it: its adder, or an admin. */
  mayChange: boolean;
}

export type TagSortKey = "name" | "related" | "by" | "added";
/** No sort means the order the page read them in: A to Z. */
export type TagSort = { key: TagSortKey; ascending: boolean } | null;

/** The way each column sorts on its first click: A–Z, newest first for the date. */
export const TAG_FIRST_CLICK_ASCENDING: Record<TagSortKey, boolean> = { name: true, related: true, by: true, added: false };

/** One click on a column heading: sort by it, or reverse it if it is already the sort. */
export function nextTagSort(now: TagSort, key: TagSortKey): TagSort {
  if (now?.key === key) return { key, ascending: !now.ascending };
  return { key, ascending: TAG_FIRST_CLICK_ASCENDING[key] };
}

const words = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** The Related Tags column as one line of words: "Budget, Roads", or "" when none. */
export function relatedNames(t: Pick<ViewTag, "related">): string {
  return t.related.map((r) => r.name).join(", ");
}

function compare(a: ViewTag, b: ViewTag, key: TagSortKey): number {
  switch (key) {
    case "name":
      return words(a.name, b.name);
    case "related":
      return words(relatedNames(a), relatedNames(b));
    case "by":
      return words(a.by, b.by);
    case "added":
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }
}

/** The tags in the chosen order. Ties keep the order they came in. */
export function sortTags<T extends ViewTag>(tags: T[], sort: TagSort): T[] {
  if (!sort) return tags;
  const sign = sort.ascending ? 1 : -1;
  return tags
    .map((t, i) => ({ t, i }))
    .sort((a, b) => sign * compare(a.t, b.t, sort.key) || a.i - b.i)
    .map(({ t }) => t);
}

/** Does this tag's name, slug or description hold the text, ignoring capitals? A plain match: "*", "%" and "_" are matched as typed. */
export function tagMatches(t: ViewTag, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return !wanted || [t.name, t.slug, t.description].some((field) => field.toLowerCase().includes(wanted));
}

export function filterTags<T extends ViewTag>(tags: T[], text: string): T[] {
  return text.trim() ? tags.filter((t) => tagMatches(t, text)) : tags;
}
