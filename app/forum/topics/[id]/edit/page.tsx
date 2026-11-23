import { possibleParents } from "../../../../../core/forum.ts";
import { loadTopic, TopicShell } from "../../loadTopic";
import TopicEditForm from "./TopicEditForm";

/**
 * Editing one Forum topic (WC-183): Name, slug, description, details (the
 * comment box's rich text editor) and Parent. Only its adder or an admin may;
 * anyone else is told so here, and the database refuses them anyway. The
 * Parent dropdown leaves out the topic itself and every topic under it, so
 * it never offers a loop.
 */
export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadTopic(id);
  if (!load.ok) {
    return (
      <TopicShell header={load.header}>
        <h1>Edit topic</h1>
        <p className="error" role="alert">{load.problem}</p>
      </TopicShell>
    );
  }
  const { topic, topics, mayChange } = load;
  if (!mayChange) {
    return (
      <TopicShell header={load.header}>
        <h1>Edit topic: {topic.name}</h1>
        <p className="error" role="alert">Only the member who added this topic, or an admin, can change it.</p>
      </TopicShell>
    );
  }
  const parents = possibleParents(topics, topic.id).map((t) => ({ id: t.id, name: t.name }));
  return (
    <TopicShell header={load.header}>
      <h1>Edit topic: {topic.name}</h1>
      <TopicEditForm
        id={topic.id}
        initial={{ name: topic.name, slug: topic.slug, description: topic.description, details: topic.details, parentId: topic.parentId ?? "" }}
        parents={parents}
      />
    </TopicShell>
  );
}
