"use client";

/**
 * The edit form for one tag (WC-186): Name, slug, description, details and
 * Related tags. Details uses the comment box's rich text editor, which only
 * types the plain marks of core/richText.ts. Related tags are tick boxes,
 * one per other tag; a tag never offers itself. A blank slug is made from
 * the name when saved. Save goes through core on the server, writing the
 * tag and its related tags together; a refusal shows in plain words and
 * every typed value and tick stays (engineering rule 6). Cancel goes back to
 * the tag's page unchanged.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { FORUM_NAME_MAX, TOPIC_DESCRIPTION_MAX, TOPIC_DETAILS_MAX, TOPIC_SLUG_MAX, topicSlug } from "../../../../../core/forum.ts";
import CommentEditor from "../../../../tasks/CommentEditor";
import { editTag, type TagForm } from "../../../actions";
import { attempt } from "../../../forumClient";

export default function TagEditForm({ id, initial, others }: { id: string; initial: TagForm; others: { id: string; name: string }[] }) {
  const [form, setForm] = useState<TagForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const f = useId();
  const set = (field: Exclude<keyof TagForm, "relatedIds">) => (value: string) => setForm((now) => ({ ...now, [field]: value }));
  const toggle = (other: string, on: boolean) =>
    setForm((now) => ({ ...now, relatedIds: on ? [...now.relatedIds.filter((r) => r !== other), other] : now.relatedIds.filter((r) => r !== other) }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = form;
    startTransition(async () => {
      const result = await attempt(() => editTag(id, typed));
      if (result.ok) {
        router.push(`/forum/tags/${id}`);
        router.refresh();
      } else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <form className="topic-form" onSubmit={submit} aria-label="Edit tag" noValidate>
      <label htmlFor={`${f}-name`}>
        Name
        <input id={`${f}-name`} type="text" maxLength={FORUM_NAME_MAX} value={form.name} disabled={pending} onChange={(e) => set("name")(e.target.value)} />
      </label>
      <label htmlFor={`${f}-slug`}>
        <span>
          Slug <span className="note hint">lower-case letters, digits and hyphens; leave blank to make one from the name</span>
        </span>
        <input id={`${f}-slug`} type="text" maxLength={TOPIC_SLUG_MAX} value={form.slug} placeholder={topicSlug(form.name, "tag")} disabled={pending}
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
        <CommentEditor label="Details" value={form.details} onChange={set("details")} maxLength={TOPIC_DETAILS_MAX} placeholder="What this tag is for, in as much depth as it needs" />
      </div>
      <fieldset className="tag-related" disabled={pending}>
        <legend>Related tags</legend>
        {others.length === 0 ? (
          <p className="note">There are no other tags yet, so there is nothing to relate this one to. Add more tags on the Forum page.</p>
        ) : (
          <>
            <p className="note hint">Tick every tag that belongs with this one. Each one you tick shows this tag back on its own row.</p>
            <ul>
              {others.map((o) => (
                <li key={o.id}>
                  <label>
                    <input type="checkbox" checked={form.relatedIds.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                    {o.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="buttons">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Link href={`/forum/tags/${id}`}>Cancel</Link>
      </div>
    </form>
  );
}
