"use client";

/**
 * The Forum's first section (WC-178): Topics on the left, Tags on the right,
 * each a fold-out Add box over a table, lined up in columns and rows (Dane,
 * 2026-11-15). On a narrow screen the two stack, Topics first.
 *
 * A save shows its error and keeps what was typed (engineering rule 6); an
 * empty table says it is empty and how to fill it (rule 7).
 */
import { useId, useState, useTransition, type FormEvent } from "react";
import type { ForumKind } from "../../core/forum.ts";
import { addForum, type ForumSaveResult } from "./actions";

export interface ListEntry {
  id: string;
  name: string;
  createdAt: string;
  by: string;
}

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again; what you typed is still here.";
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

async function attempt(action: () => Promise<ForumSaveResult>): Promise<ForumSaveResult> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

const WORDS: Record<ForumKind, { title: string; one: string; add: string }> = {
  topic: { title: "Topics", one: "topic", add: "Add Topic" },
  tag: { title: "Tags", one: "tag", add: "Add Tag" },
};

export default function ForumLists({ topics, tags }: { topics: ListEntry[] | string; tags: ListEntry[] | string }) {
  return (
    <section className="forum-lists" aria-label="Topics and tags">
      <Column kind="topic" entries={topics} />
      <Column kind="tag" entries={tags} />
    </section>
  );
}

/** One side. `entries` is the list, or the reason it could not be read. */
function Column({ kind, entries }: { kind: ForumKind; entries: ListEntry[] | string }) {
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
        ) : (
          <table className="game members forum-table">
            <thead>
              <tr>
                <th scope="col">{words.title.slice(0, -1)}</th>
                <th scope="col">Added by</th>
                <th scope="col" className="num">Added</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="note">
                    No {words.title.toLowerCase()} yet. Open {words.add} above to add the first one.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td title={entry.name}>{entry.name}</td>
                    <td className="note">{entry.by}</td>
                    <td className="num note">
                      <time dateTime={entry.createdAt}>{DATE.format(new Date(entry.createdAt))}</time>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
