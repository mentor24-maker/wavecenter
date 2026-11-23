"use client";

/**
 * The edit form for one topic: Name, slug, description, details and Parent.
 * Details uses the comment box's rich text editor (bold, italic, lists,
 * links, Preview), which only types the plain marks of core/richText.ts.
 * A blank slug is made from the name when saved. Save goes through core on
 * the server; a refusal shows in plain words and every typed value stays
 * (engineering rule 6). Cancel goes back to the topic's page unchanged.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { FORUM_NAME_MAX, TOPIC_DESCRIPTION_MAX, TOPIC_DETAILS_MAX, TOPIC_SLUG_MAX, topicSlug } from "../../../../../core/forum.ts";
import CommentEditor from "../../../../tasks/CommentEditor";
import { editTopic, type TopicForm } from "../../../actions";
import { attempt } from "../../../forumClient";

export default function TopicEditForm({ id, initial, parents }: { id: string; initial: TopicForm; parents: { id: string; name: string }[] }) {
  const [form, setForm] = useState<TopicForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const f = useId();
  const set = (field: keyof TopicForm) => (value: string) => setForm((now) => ({ ...now, [field]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = form;
    startTransition(async () => {
      const result = await attempt(() => editTopic(id, typed));
      if (result.ok) {
        router.push(`/forum/topics/${id}`);
        router.refresh();
      } else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <form className="topic-form" onSubmit={submit} aria-label="Edit topic" noValidate>
      <label htmlFor={`${f}-name`}>
        Name
        <input id={`${f}-name`} type="text" maxLength={FORUM_NAME_MAX} value={form.name} disabled={pending} onChange={(e) => set("name")(e.target.value)} />
      </label>
      <label htmlFor={`${f}-slug`}>
        <span>
          Slug <span className="note hint">lower-case letters, digits and hyphens; leave blank to make one from the name</span>
        </span>
        <input id={`${f}-slug`} type="text" maxLength={TOPIC_SLUG_MAX} value={form.slug} placeholder={topicSlug(form.name)} disabled={pending}
          onChange={(e) => set("slug")(e.target.value)} />
      </label>
      <label htmlFor={`${f}-description`}>
        <span>
          Description <span className="note hint">one line, at most {TOPIC_DESCRIPTION_MAX} characters</span>
        </span>
        <input id={`${f}-description`} type="text" maxLength={TOPIC_DESCRIPTION_MAX} value={form.description} disabled={pending}
          onChange={(e) => set("description")(e.target.value)} />
      </label>
      <div className="topic-form-details">
        <p className="label"><strong>Details</strong></p>
        <CommentEditor label="Details" value={form.details} onChange={set("details")} maxLength={TOPIC_DETAILS_MAX} placeholder="What this topic is about, in as much depth as it needs" />
      </div>
      <label htmlFor={`${f}-parent`}>
        Parent
        <select id={`${f}-parent`} value={form.parentId} disabled={pending} onChange={(e) => set("parentId")(e.target.value)}>
          <option value="">None (a top-level topic)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="buttons">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Link href={`/forum/topics/${id}`}>Cancel</Link>
      </div>
    </form>
  );
}
