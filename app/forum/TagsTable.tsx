"use client";

/**
 * The Forum's Tags table (WC-186): a text filter that narrows as you type,
 * headings that sort when clicked (click again to reverse), a Related Tags
 * column (in place of the Topics table's Parent) and View / Edit / Delete on
 * every row. No Clone.
 *
 * Edit and Delete work only for the tag's adder or an admin; for anyone else
 * they are shown greyed out with the reason, and the database refuses them
 * anyway. Delete asks first. Filtering and sorting work on the tags already
 * loaded (tagView.ts). An empty table always says why (rule 7).
 */
import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { deleteTag } from "./actions";
import { attempt, DATE } from "./forumClient";
import { filterTags, nextTagSort, sortTags, type TagSort, type TagSortKey, type ViewTag } from "./tagView";

const NOT_YOURS = "Only the member who added this tag, or an admin, can change or delete it.";

export default function TagsTable({ tags }: { tags: ViewTag[] }) {
  const [sort, setSort] = useState<TagSort>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filtering = filter.trim() !== "";
  const shown = filterTags(sortTags(tags, sort), filter);

  const sortHeading = (key: TagSortKey, label: string, className?: string) => {
    const on = sort?.key === key;
    return (
      <th scope="col" className={className} aria-sort={on ? (sort.ascending ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => setSort(nextTagSort(sort, key))}>
          {label}
          <span aria-hidden="true" className="arrow">{on ? (sort.ascending ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  function remove(tag: ViewTag) {
    if (!window.confirm(`Delete tag "${tag.name}"?`)) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await attempt(() => deleteTag(tag.id));
      if (result.ok) setNotice(`Deleted "${tag.name}".`);
      else setError(`Not deleted. ${result.error}`);
    });
  }

  return (
    <>
      <form className="filters forum-filters" aria-label="Filter tags" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Filter tags by name, slug or description"
          placeholder="Filter tags"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filtering && (
          <button type="button" className="link" onClick={() => setFilter("")}>Clear filter</button>
        )}
      </form>
      {filtering && <p className="note" role="status">Showing {shown.length} of {tags.length} tags.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="note" role="status">{notice}</p>}

      <table className="game members forum-table forum-tags">
        <thead>
          <tr>
            {sortHeading("name", "Tag")}
            {sortHeading("related", "Related Tags")}
            {sortHeading("by", "Added by")}
            {sortHeading("added", "Added", "num")}
            <th scope="col" className="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.length === 0 ? (
            <tr>
              <td colSpan={5} className="note">No tags yet. Open Add Tag above to add the first one.</td>
            </tr>
          ) : shown.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <span className="note" role="status">No tags match this filter. </span>
                <button type="button" className="link" onClick={() => setFilter("")}>Clear the filter</button>
              </td>
            </tr>
          ) : (
            shown.map((t) => (
              <tr key={t.id}>
                <td title={t.description || t.name}>
                  <Link href={`/forum/tags/${t.id}`}>{t.name}</Link>
                </td>
                <td className="note forum-related">
                  {t.related.map((r, i) => (
                    <Fragment key={r.id}>
                      {i > 0 && ", "}
                      <Link href={`/forum/tags/${r.id}`}>{r.name}</Link>
                    </Fragment>
                  ))}
                </td>
                <td className="note">{t.by}</td>
                <td className="num note">
                  <time dateTime={t.createdAt}>{DATE.format(new Date(t.createdAt))}</time>
                </td>
                <td className="member-actions forum-actions">
                  <Link href={`/forum/tags/${t.id}`} aria-label={`View ${t.name}`}>View</Link>
                  {t.mayChange ? (
                    <Link href={`/forum/tags/${t.id}/edit`} aria-label={`Edit ${t.name}`}>Edit</Link>
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
