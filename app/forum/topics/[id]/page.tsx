import Link from "next/link";
import RichText from "../../../tasks/RichText";
import { DATE } from "../../forumClient";
import { loadTopic, TopicShell } from "../loadTopic";

/**
 * One Forum topic on its own page (WC-183): its name, slug, parent,
 * description and details (rich text, drawn safely by RichText), who added it
 * and when, and when it last changed. Its adder or an admin sees an Edit
 * link. Anything missing says so rather than leaving a blank (rule 7).
 */
export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadTopic(id);
  if (!load.ok) {
    return (
      <TopicShell header={load.header}>
        <h1>Topic</h1>
        <p className="error" role="alert">{load.problem}</p>
      </TopicShell>
    );
  }

  const { topic, topics, mayChange, namer } = load;
  const parent = topic.parentId ? topics.find((t) => t.id === topic.parentId) : undefined;
  const changed = topic.updatedAt && topic.updatedAt !== topic.createdAt;

  return (
    <TopicShell header={load.header}>
      <h1>{topic.name}</h1>
      <dl className="topic-facts">
        <dt>Slug</dt>
        <dd><code>{topic.slug}</code></dd>
        <dt>Parent</dt>
        <dd>{parent ? <Link href={`/forum/topics/${parent.id}`}>{parent.name}</Link> : <span className="note">None: this is a top-level topic.</span>}</dd>
        <dt>Description</dt>
        <dd>{topic.description || <span className="note">No description yet.</span>}</dd>
        <dt>Added</dt>
        <dd>
          by {namer(topic.createdBy)} on <time dateTime={topic.createdAt}>{DATE.format(new Date(topic.createdAt))}</time>
          {changed && (
            <span className="note"> · last changed <time dateTime={topic.updatedAt}>{DATE.format(new Date(topic.updatedAt))}</time></span>
          )}
        </dd>
      </dl>
      <h2>Details</h2>
      {topic.details.trim() ? (
        <RichText body={topic.details} className="topic-details" />
      ) : (
        <p className="note">No details yet.{mayChange ? " Choose Edit topic to add some." : ""}</p>
      )}
      {mayChange ? (
        <p>
          <Link className="button" href={`/forum/topics/${topic.id}/edit`}>Edit topic</Link>
        </p>
      ) : (
        <p className="note">Only the member who added this topic, or an admin, can change it.</p>
      )}
    </TopicShell>
  );
}
