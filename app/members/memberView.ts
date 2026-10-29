/**
 * How the member table is filtered and sorted in the browser, on the members
 * the page already loaded: nothing here reads or writes the database. Plain
 * functions with their own tests (memberView.test.ts), modelled on the task
 * list's (app/tasks/listView.ts).
 */
import { ROLES, type RoleKey } from "../../core/members.ts";

/** The fields of a member the filters and sorts look at. */
export interface ViewMember {
  memberId: string;
  role: RoleKey;
  /** Null when their profile does not show a name. */
  displayName: string | null;
  joinedAt: string;
}

/** What a member with no name on show is called. */
export const ANONYMOUS = "Anonymous member";

/** The name the table shows for a member, which is also what the text filter matches. */
export function shownName(m: Pick<ViewMember, "displayName">): string {
  return m.displayName?.trim() || ANONYMOUS;
}

export type MemberSortKey = "name" | "joined" | "role";
/** No sort means the order the page read them in: oldest member first. */
export type MemberSort = { key: MemberSortKey; ascending: boolean } | null;

/** The way each column sorts on its first click: A–Z, newest first, Admin first. */
export const FIRST_CLICK_ASCENDING: Record<MemberSortKey, boolean> = { name: true, joined: false, role: true };

/** One click on a column heading: sort by it, or reverse it if it is already the sort. */
export function nextSort(now: MemberSort, key: MemberSortKey): MemberSort {
  if (now?.key === key) return { key, ascending: !now.ascending };
  return { key, ascending: FIRST_CLICK_ASCENDING[key] };
}

const ROLE_RANK = new Map(ROLES.map((r, i) => [r.key as string, i]));

function compare(a: ViewMember, b: ViewMember, key: MemberSortKey): number {
  switch (key) {
    case "name":
      return shownName(a).localeCompare(shownName(b), undefined, { sensitivity: "base", numeric: true });
    case "joined":
      return a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0;
    case "role":
      return (ROLE_RANK.get(a.role) ?? ROLES.length) - (ROLE_RANK.get(b.role) ?? ROLES.length);
  }
}

/** The members in the chosen order. Ties keep the order they came in. */
export function sortMembers<T extends ViewMember>(members: T[], sort: MemberSort): T[] {
  if (!sort) return members;
  const sign = sort.ascending ? 1 : -1;
  return members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => sign * compare(a.m, b.m, sort.key) || a.i - b.i)
    .map(({ m }) => m);
}

export interface MemberFilter {
  /** Matched against the name shown, ignoring capitals. */
  text: string;
  role: RoleKey | "all";
}

export const NO_MEMBER_FILTER: MemberFilter = { text: "", role: "all" };

export function isFiltering(f: MemberFilter): boolean {
  return f.text.trim() !== "" || f.role !== "all";
}

/** Does this one member match every filter set? */
export function matches(m: ViewMember, f: MemberFilter): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !shownName(m).toLowerCase().includes(text)) return false;
  if (f.role !== "all" && m.role !== f.role) return false;
  return true;
}

export function filterMembers<T extends ViewMember>(members: T[], f: MemberFilter): T[] {
  return isFiltering(f) ? members.filter((m) => matches(m, f)) : members;
}
