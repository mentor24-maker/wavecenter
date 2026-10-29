"use client";

/**
 * The member table: a filter row (name and role), headings that sort when
 * clicked (Member, Joined, Role), and an Actions column holding the buttons
 * the viewer's role may use. Which buttons those are is decided in core
 * (memberActions in core/members.ts) and handed in by the page; the database
 * still refuses an action the viewer may not take. Filtering and sorting work
 * on the members already loaded (memberView.ts).
 */
import { useState } from "react";
import { ROLES, type MemberActionKey } from "../../core/members.ts";
import { AVATARS } from "../../core/profiles.ts";
import type { MemberRow } from "../lib/memberRoleStore";
import {
  NO_MEMBER_FILTER,
  filterMembers,
  isFiltering,
  nextSort,
  shownName,
  sortMembers,
  type MemberFilter,
  type MemberSort,
  type MemberSortKey,
} from "./memberView";
import RolePicker from "./RolePicker";

export type MemberTableRow = MemberRow & { joinedLabel: string };

const roleName = (key: string) => ROLES.find((r) => r.key === key)?.name ?? key;

export default function MemberTable({ members, me, actions }: { members: MemberTableRow[]; me: string; actions: MemberActionKey[] }) {
  const [sort, setSort] = useState<MemberSort>(null);
  const [filter, setFilter] = useState<MemberFilter>(NO_MEMBER_FILTER);
  const filtering = isFiltering(filter);
  const shown = filterMembers(sortMembers(members, sort), filter);
  const columns = 3 + (actions.length ? 1 : 0);

  /** A heading that sorts the table: shows the sort and its direction, and says so to screen readers. */
  const sortHeading = (key: MemberSortKey, label: string) => {
    const on = sort?.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort.ascending ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => setSort(nextSort(sort, key))}>
          {label}
          <span aria-hidden="true" className="arrow">{on ? (sort.ascending ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <>
      <form className="filters" aria-label="Filter members" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Filter by member name"
          placeholder="Filter by name"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <select
          aria-label="Filter by role"
          value={filter.role}
          onChange={(e) => setFilter({ ...filter, role: e.target.value as MemberFilter["role"] })}
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => (
            <option key={r.key} value={r.key}>{r.name}</option>
          ))}
        </select>
        {filtering && (
          <button type="button" className="link" onClick={() => setFilter(NO_MEMBER_FILTER)}>Clear filters</button>
        )}
      </form>
      {filtering && (
        <p className="note" role="status">Showing {shown.length} of {members.length} members.</p>
      )}

      <table className="game members">
        <thead>
          <tr>
            {sortHeading("name", "Member")}
            {sortHeading("joined", "Joined")}
            {sortHeading("role", "Role")}
            {actions.length > 0 && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns}>
                <span className="note" role="status">No member matches these filters. </span>
                <button type="button" className="link" onClick={() => setFilter(NO_MEMBER_FILTER)}>Clear the filters</button>
              </td>
            </tr>
          ) : (
            shown.map((m) => {
              const name = shownName(m);
              const symbol = AVATARS.find((a) => a.id === m.avatar)?.symbol ?? "👤";
              const you = m.memberId === me;
              return (
                <tr key={m.memberId}>
                  <td>
                    <span aria-hidden="true">{symbol}</span> {name}
                    {you && <span className="note"> (you)</span>}
                  </td>
                  <td className="note">{m.joinedLabel}</td>
                  <td>{roleName(m.role)}</td>
                  {actions.length > 0 && (
                    <td>
                      {actions.includes("change-role") && (
                        <RolePicker memberId={m.memberId} initial={m.role} label={you ? "you" : name} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </>
  );
}
