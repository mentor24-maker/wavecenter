import { loadTag, TagShell } from "../../loadTag";
import TagEditForm from "./TagEditForm";

/**
 * Editing one Forum tag (WC-186): Name, slug, description, details (the
 * comment box's rich text editor) and Related tags, ticked from every other
 * tag. Only its adder or an admin may; anyone else is told so here, and the
 * database refuses them anyway.
 */
export default async function EditTagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadTag(id);
  if (!load.ok) {
    return (
      <TagShell header={load.header}>
        <h1>Edit tag</h1>
        <p className="error" role="alert">{load.problem}</p>
      </TagShell>
    );
  }
  const { tag, tags, mayChange } = load;
  if (!mayChange) {
    return (
      <TagShell header={load.header}>
        <h1>Edit tag: {tag.name}</h1>
        <p className="error" role="alert">Only the member who added this tag, or an admin, can change it.</p>
      </TagShell>
    );
  }
  const others = tags.filter((t) => t.id !== tag.id).map((t) => ({ id: t.id, name: t.name }));
  return (
    <TagShell header={load.header}>
      <h1>Edit tag: {tag.name}</h1>
      <TagEditForm
        id={tag.id}
        initial={{ name: tag.name, slug: tag.slug, description: tag.description, details: tag.details, relatedIds: tag.relatedIds }}
        others={others}
      />
    </TagShell>
  );
}
