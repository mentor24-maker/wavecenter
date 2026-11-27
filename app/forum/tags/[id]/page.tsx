import Link from "next/link";
import { Fragment } from "react";
import RichText from "../../../tasks/RichText";
import { DATE } from "../../forumClient";
import { loadTag, relatedOf, TagShell } from "../loadTag";

/**
 * One Forum tag on its own page (WC-186): its name, slug, related tags,
 * description and details (rich text, drawn safely by RichText), who added it
 * and when, and when it last changed, and the topics that carry it (WC-249),
 * each a link to the topic. Its adder or an admin sees an Edit
 * link. Anything missing says so rather than leaving a blank (rule 7).
 */
export default async function TagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadTag(id);
  if (!load.ok) {
    return (
      <TagShell header={load.header}>
        <h1>Tag</h1>
        <p className="error" role="alert">{load.problem}</p>
      </TagShell>
    );
  }

  const { tag, tags, topics, mayChange, namer } = load;
  const related = relatedOf(tag, tags);
  const changed = tag.updatedAt && tag.updatedAt !== tag.createdAt;

  return (
    <TagShell header={load.header}>
      <h1>{tag.name}</h1>
      <dl className="topic-facts">
        <dt>Slug</dt>
        <dd><code>{tag.slug}</code></dd>
        <dt>Related tags</dt>
        <dd>
          {related.length ? (
            related.map((r, i) => (
              <Fragment key={r.id}>
                {i > 0 && ", "}
                <Link href={`/forum/tags/${r.id}`}>{r.name}</Link>
              </Fragment>
            ))
          ) : (
            <span className="note">None yet.</span>
          )}
        </dd>
        <dt>Description</dt>
        <dd>{tag.description || <span className="note">No description yet.</span>}</dd>
        <dt>Added</dt>
        <dd>
          by {namer(tag.createdBy)} on <time dateTime={tag.createdAt}>{DATE.format(new Date(tag.createdAt))}</time>
          {changed && (
            <span className="note"> · last changed <time dateTime={tag.updatedAt}>{DATE.format(new Date(tag.updatedAt))}</time></span>
          )}
        </dd>
      </dl>
      <h2>Topics with this tag</h2>
      {!topics.ok ? (
        <p className="error" role="alert">{topics.problem}</p>
      ) : topics.topics.length ? (
        <ul className="topic-subtopics">
          {topics.topics.map((t) => (
            <li key={t.id}><Link href={`/forum/topics/${t.id}`}>{t.name}</Link></li>
          ))}
        </ul>
      ) : (
        <p className="note">No topics carry this tag yet.</p>
      )}
      <h2>Details</h2>
      {tag.details.trim() ? (
        <RichText body={tag.details} className="topic-details" />
      ) : (
        <p className="note">No details yet.{mayChange ? " Choose Edit tag to add some." : ""}</p>
      )}
      {mayChange ? (
        <p>
          <Link className="button" href={`/forum/tags/${tag.id}/edit`}>Edit tag</Link>
        </p>
      ) : (
        <p className="note">Only the member who added this tag, or an admin, can change it.</p>
      )}
    </TagShell>
  );
}
