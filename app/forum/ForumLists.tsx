"use client";

/**
 * The Forum's first section (WC-178): Topics on the left, Tags on the right,
 * each a fold-out Add box over a table, lined up in columns and rows (Dane,
 * 2026-11-15). On a narrow screen the two stack, Topics first.
 *
 * The Topics table (WC-183) has headings that sort when clicked, a Parent
 * column, a filter bar (text and parent topic) and View / Edit / Delete on
 * each row (TopicsTable.tsx). The Tags table (WC-186) is its twin, with a
 * Related Tags column in place of Parent (TagsTable.tsx).
 *
 * A save shows its error and keeps what was typed (engineering rule 6); an
 * empty table says it is empty and how to fill it (rule 7).
 */
import { useId, useState, useTransition, type FormEvent } from "react";
import type { ForumKind } from "../../core/forum.ts";
import { addForum } from "./actions";
import { attempt } from "./forumClient";
import TagsTable from "./TagsTable";
import TopicsTable from "./TopicsTable";
import type { ViewTag } from "./tagView";
import type { ViewTopic } from "./topicView";

const WORDS: Record<ForumKind, { title: string; one: string; add: string }> = {
  topic: { title: "Topics", one: "topic", add: "Add Topic" },
  tag: { title: "Tags", one: "tag", add: "Add Tag" },
};

export default function ForumLists({ topics, tags }: { topics: ViewTopic[] | string; tags: ViewTag[] | string }) {
  return (
    <section className="forum-lists" aria-label="Topics and tags">
      <Column kind="topic" entries={topics} />
      <Column kind="tag" entries={tags} />
    </section>
  );
}

/** One side. `entries` is the list, or the reason it could not be read. */
function Column({ kind, entries }: { kind: ForumKind; entries: ViewTopic[] | ViewTag[] | string }) {
  const words = WORDS[kind];
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const typed = name;
    startTransition(async () => {
      const result = await attempt(() => addForum(kind, typed));
      if (result.ok) {
        setName("");
        setNotice(`Added "${typed.trim()}".`);
      } else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <>
      <h2 className={`forum-${kind}-title`}>{words.title}</h2>
      <details className={`forum-add forum-${kind}-add`}>
        <summary>{words.add}</summary>
        <form className="forum-add-form" onSubmit={submit} aria-label={words.add} noValidate>
          <label htmlFor={`${id}-name`} className="sr-only">{`New ${words.one}'s name`}</label>
          <input id={`${id}-name`} type="text" maxLength={80} value={name} placeholder={`New ${words.one}`}
            onChange={(e) => setName(e.target.value)} disabled={pending} />
          <button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="note" role="status">{notice}</p>}
      </details>
      <div className={`forum-${kind}-table`}>
        {typeof entries === "string" ? (
          <p className="error" role="alert">
            The {words.title.toLowerCase()} could not be loaded: {entries}. Nothing has been lost; try reloading the page.
          </p>
        ) : kind === "topic" ? (
          <TopicsTable topics={entries as ViewTopic[]} />
        ) : (
          <TagsTable tags={entries as ViewTag[]} />
        )}
      </div>
    </>
  );
}
