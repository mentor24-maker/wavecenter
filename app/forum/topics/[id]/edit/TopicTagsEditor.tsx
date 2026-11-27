"use client";

/**
 * The Tags control on a topic's edit page (WC-249): the tags the topic
 * carries now, each with a Remove button, and a dropdown of the other
 * existing tags with an Add tag button. Each change is saved straight away
 * through core on the server, apart from the form's own Save. A change that
 * fails says why and keeps the choice (engineering rule 6). New tags are made
 * on the Forum's Tags list, not here.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { attachTopicTag, detachTopicTag } from "../../../actions";
import { attempt } from "../../../forumClient";
import type { TagChoice } from "../../loadTopic";

export default function TopicTagsEditor({ topicId, carried, all }: { topicId: string; carried: TagChoice[]; all: TagChoice[] }) {
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const id = useId();
  const carriedIds = new Set(carried.map((t) => t.id));
  const addable = all.filter((t) => !carriedIds.has(t.id));

  function change(save: () => Promise<{ ok: true } | { ok: false; error: string }>, said: string, after?: () => void) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await attempt(save);
      if (result.ok) {
        setDone(said);
        after?.();
        router.refresh();
      } else setError(`Not saved. ${result.error}`);
    });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const tag = addable.find((t) => t.id === chosen);
    if (!tag) return;
    change(() => attachTopicTag(topicId, tag.id), `Added "${tag.name}".`, () => setChosen(""));
  }

  return (
    <section className="topic-tags-editor" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Tags</h2>
      {carried.length ? (
        <ul className="topic-tag-list">
          {carried.map((t) => (
            <li key={t.id}>
              <Link href={`/forum/tags/${t.id}`}>{t.name}</Link>{" "}
              <button type="button" disabled={pending} aria-label={`Remove the tag ${t.name}`}
                onClick={() => change(() => detachTopicTag(topicId, t.id), `Removed "${t.name}".`)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">No tags yet.</p>
      )}
      {all.length === 0 ? (
        <p className="note">There are no tags to attach yet. Add one on the <Link href="/forum">Forum&apos;s Tags list</Link> first.</p>
      ) : addable.length === 0 ? (
        <p className="note">This topic carries every tag there is.</p>
      ) : (
        <form className="topic-picker" onSubmit={add} aria-label="Add a tag">
          <label htmlFor={id}><strong>Add a tag</strong></label>
          <div className="topic-picker-row">
            <select id={id} value={chosen} disabled={pending} onChange={(e) => { setChosen(e.target.value); setDone(null); }}>
              <option value="">Choose a tag…</option>
              {addable.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button type="submit" disabled={pending || chosen === ""}>{pending ? "Saving…" : "Add tag"}</button>
          </div>
        </form>
      )}
      {done && <p className="note" role="status">{done}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
