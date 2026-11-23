"use client";

/**
 * The Forum's Topics table (WC-183): a filter bar (text that narrows as you
 * type, and a Parent topic dropdown), headings that sort when clicked (click
 * again to reverse), and View / Edit / Delete on every row. No Clone.
 *
 * Edit and Delete work only for the topic's adder or an admin; for anyone
 * else they are shown greyed out with the reason, and the database refuses
 * them anyway. Delete asks first. Filtering and sorting work on the topics
 * already loaded (topicView.ts). An empty table always says why (rule 7).
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteTopic } from "./actions";
import { attempt, DATE } from "./forumClient";
import {
  NO_TOPIC_FILTER,
  filterTopics,
  isFilteringTopics,
  nextTopicSort,
  parentChoices,
  sortTopics,
  type TopicFilter,
  type TopicSort,
  type TopicSortKey,
  type ViewTopic,
} from "./topicView";

const NOT_YOURS = "Only the member who added this topic, or an admin, can change or delete it.";

export default function TopicsTable({ topics }: { topics: ViewTopic[] }) {
  const [sort, setSort] = useState<TopicSort>(null);
  const [filter, setFilter] = useState<TopicFilter>(NO_TOPIC_FILTER);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filtering = isFilteringTopics(filter);
  const shown = filterTopics(sortTopics(topics, sort), filter);
  const parents = parentChoices(topics);
  // A parent chosen in the filter that has since lost its sub-topics stays choosable, so the dropdown never lies.
  const chosenGone = filter.parent !== "any" && filter.parent !== "none" && !parents.some((p) => p.id === filter.parent);

  const sortHeading = (key: TopicSortKey, label: string, className?: string) => {
    const on = sort?.key === key;
    return (
      <th scope="col" className={className} aria-sort={on ? (sort.ascending ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => setSort(nextTopicSort(sort, key))}>
          {label}
          <span aria-hidden="true" className="arrow">{on ? (sort.ascending ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  function remove(topic: ViewTopic) {
    if (!window.confirm(`Delete topic "${topic.name}"? Its sub-topics will have no parent.`)) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await attempt(() => deleteTopic(topic.id));
      if (result.ok) {
        setNotice(`Deleted "${topic.name}".`);
        if (filter.parent === topic.id) setFilter({ ...filter, parent: "any" });
      } else setError(`Not deleted. ${result.error}`);
    });
  }

  return (
    <>
      <form className="filters forum-filters" aria-label="Filter topics" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Filter topics by name, slug or description"
          placeholder="Filter topics"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <select aria-label="Filter by parent topic" value={filter.parent} onChange={(e) => setFilter({ ...filter, parent: e.target.value })}>
          <option value="any">Any parent</option>
          <option value="none">No parent</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>Under {p.name}</option>
          ))}
          {chosenGone && <option value={filter.parent}>Under a topic with no sub-topics now</option>}
        </select>
        {filtering && (
          <button type="button" className="link" onClick={() => setFilter(NO_TOPIC_FILTER)}>Clear filters</button>
        )}
      </form>
      {filtering && <p className="note" role="status">Showing {shown.length} of {topics.length} topics.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

      <table className="game members forum-table forum-topics">
        <thead>
          <tr>
            {sortHeading("name", "Topic")}
            {sortHeading("parent", "Parent")}
            {sortHeading("by", "Added by")}
            {sortHeading("added", "Added", "num")}
            <th scope="col" className="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {topics.length === 0 ? (
            <tr>
              <td colSpan={5} className="note">No topics yet. Open Add Topic above to add the first one.</td>
            </tr>
          ) : shown.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <span className="note" role="status">No topics match this filter. </span>
                <button type="button" className="link" onClick={() => setFilter(NO_TOPIC_FILTER)}>Clear the filters</button>
              </td>
            </tr>
          ) : (
            shown.map((t) => (
              <tr key={t.id}>
                <td title={t.description || t.name}>
                  <Link href={`/forum/topics/${t.id}`}>{t.name}</Link>
                </td>
                <td className="note">{t.parentName}</td>
                <td className="note">{t.by}</td>
                <td className="num note">
                  <time dateTime={t.createdAt}>{DATE.format(new Date(t.createdAt))}</time>
                </td>
                <td className="member-actions forum-actions">
                  <Link href={`/forum/topics/${t.id}`} aria-label={`View ${t.name}`}>View</Link>
                  {t.mayChange ? (
                    <Link href={`/forum/topics/${t.id}/edit`} aria-label={`Edit ${t.name}`}>Edit</Link>
                  ) : (
                    <span className="note" title={NOT_YOURS} aria-disabled="true">Edit</span>
                  )}
                  <button
                    type="button"
                    className="link danger"
                    aria-label={`Delete ${t.name}`}
                    title={t.mayChange ? undefined : NOT_YOURS}
                    disabled={!t.mayChange || pending}
                    onClick={() => remove(t)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
