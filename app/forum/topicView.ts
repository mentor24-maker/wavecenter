/**
 * How the Forum's Topics table is filtered and sorted in the browser, on the
 * topics the page already loaded: nothing here reads or writes the database.
 * Plain functions with their own tests (topicView.test.ts), modelled on the
 * member table's (app/members/memberView.ts).
 */

/** One row of the Topics table. */
export interface ViewTopic {
  id: string;
  name: string;
  slug: string;
  description: string;
  parentId: string | null;
  /** The parent's name, or "" when it has none. */
  parentName: string;
  /** Who added it, as the table shows it ("you", a name, "a former member"). */
  by: string;
  createdAt: string;
  /** May the viewer change and delete it: its adder, or an admin. */
  mayChange: boolean;
}

export type TopicSortKey = "name" | "parent" | "by" | "added";
/** No sort means the order the page read them in: A to Z. */
export type TopicSort = { key: TopicSortKey; ascending: boolean } | null;

/** The way each column sorts on its first click: A–Z, newest first for the date. */
export const FIRST_CLICK_ASCENDING: Record<TopicSortKey, boolean> = { name: true, parent: true, by: true, added: false };

/** One click on a column heading: sort by it, or reverse it if it is already the sort. */
export function nextTopicSort(now: TopicSort, key: TopicSortKey): TopicSort {
  if (now?.key === key) return { key, ascending: !now.ascending };
  return { key, ascending: FIRST_CLICK_ASCENDING[key] };
}

const words = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

function compare(a: ViewTopic, b: ViewTopic, key: TopicSortKey): number {
  switch (key) {
    case "name":
      return words(a.name, b.name);
    case "parent":
      return words(a.parentName, b.parentName);
    case "by":
      return words(a.by, b.by);
    case "added":
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }
}

/** The topics in the chosen order. Ties keep the order they came in. */
export function sortTopics<T extends ViewTopic>(topics: T[], sort: TopicSort): T[] {
  if (!sort) return topics;
  const sign = sort.ascending ? 1 : -1;
  return topics
    .map((t, i) => ({ t, i }))
    .sort((a, b) => sign * compare(a.t, b.t, sort.key) || a.i - b.i)
    .map(({ t }) => t);
}

/** "any": every topic. "none": only topics with no parent. Otherwise a parent's id: only its sub-topics. */
export type ParentFilter = "any" | "none" | string;

export interface TopicFilter {
  /** Matched against the name, slug and description, ignoring capitals; never a wildcard. */
  text: string;
  parent: ParentFilter;
}

export const NO_TOPIC_FILTER: TopicFilter = { text: "", parent: "any" };

export function isFilteringTopics(f: TopicFilter): boolean {
  return f.text.trim() !== "" || f.parent !== "any";
}

/** Does this one topic match every filter set? A plain string match: "*", "%" and "_" are matched as typed. */
export function topicMatches(t: ViewTopic, f: TopicFilter): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && ![t.name, t.slug, t.description].some((field) => field.toLowerCase().includes(text))) return false;
  if (f.parent === "none" && t.parentId !== null) return false;
  if (f.parent !== "any" && f.parent !== "none" && t.parentId !== f.parent) return false;
  return true;
}

export function filterTopics<T extends ViewTopic>(topics: T[], f: TopicFilter): T[] {
  return isFilteringTopics(f) ? topics.filter((t) => topicMatches(t, f)) : topics;
}

/** The Parent topic dropdown's choices: every topic that has a sub-topic, A to Z. */
export function parentChoices(topics: readonly ViewTopic[]): { id: string; name: string }[] {
  const withChildren = new Set(topics.flatMap((t) => (t.parentId ? [t.parentId] : [])));
  return topics
    .filter((t) => withChildren.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => words(a.name, b.name));
}
