"use client";

/**
 * A task's Discussion: its comments, oldest first, in a plain forum layout,
 * with a filter bar (words, and Both / Human / AI) above and a box to post a
 * new comment below. Whether a comment is from a person or AI, and what the
 * filter lets through, is decided in core/comments.ts.
 *
 * A comment is shown as plain text, never as HTML, so nothing typed into one
 * can run in the browser. A post or edit that fails keeps what was typed and
 * the row says why (engineering rule 6); a thread the filter empties says so
 * (rule 7).
 */
import { useState, type FormEvent } from "react";
import {
  commentAuthorKind,
  filterComments,
  MAX_COMMENT_LENGTH,
  NO_COMMENT_FILTER,
  type CommentFilter,
  type TaskComment,
} from "../../core/comments.ts";
import { changeComment, deleteComment, postComment, type SaveResult } from "./actions";
import { fullDate } from "./listView.ts";

const KIND_LABEL = { human: "Human", ai: "AI" } as const;

export default function Discussion({
  taskId,
  taskTitle,
  comments,
  userId,
  pending,
  run,
}: {
  taskId: string;
  taskTitle: string;
  comments: TaskComment[];
  userId: string;
  pending: boolean;
  run: (action: () => Promise<SaveResult>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<CommentFilter>(NO_COMMENT_FILTER);
  const [editing, setEditing] = useState<string | null>(null);
  const [edited, setEdited] = useState("");
  const shown = filterComments(comments, filter);
  const filtering = filter.text.trim() !== "" || filter.kind !== "both";

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    // Cleared only on a confirmed save; a failed one keeps the words as typed.
    if (await run(() => postComment(taskId, draft))) setDraft("");
  }

  async function saveEdit(e: FormEvent, comment: TaskComment) {
    e.preventDefault();
    if (edited.trim() === comment.body) return setEditing(null);
    if (await run(() => changeComment(comment.id, edited))) setEditing(null);
  }

  /** Who wrote it: you or another member through WaveCenter, or the AI tool by name. */
  const author = (c: TaskComment) =>
    commentAuthorKind(c) === "ai" ? c.tool : c.ownerId === userId ? "You" : `Member ${c.ownerId.slice(0, 8)}`;

  return (
    <section className="discussion" aria-label={`Discussion on "${taskTitle}"`}>
      <h3>Discussion</h3>
      {comments.length > 0 && (
        <form className="filters" aria-label={`Filter the discussion on "${taskTitle}"`} onSubmit={(e) => e.preventDefault()}>
          <input
            type="search"
            aria-label="Search the comments"
            placeholder="Search comments"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
          <select
            aria-label="Show comments by"
            value={filter.kind}
            onChange={(e) => setFilter({ ...filter, kind: e.target.value as CommentFilter["kind"] })}
          >
            <option value="both">Human and AI</option>
            <option value="human">Human only</option>
            <option value="ai">AI only</option>
          </select>
          {filtering && (
            <button type="button" className="link" onClick={() => setFilter(NO_COMMENT_FILTER)}>Clear</button>
          )}
        </form>
      )}

      {comments.length === 0 ? (
        <p className="note">No comments yet. Start the discussion below.</p>
      ) : shown.length === 0 ? (
        <p className="note" role="status">
          {noMatch(filter)}{" "}
          <button type="button" className="link" onClick={() => setFilter(NO_COMMENT_FILTER)}>Show every comment</button>
        </p>
      ) : (
        <ol className="comments">
          {shown.map((c) => {
            const kind = commentAuthorKind(c);
            return (
              <li key={c.id} className={`comment ${kind}`}>
                <p className="meta">
                  <strong>{author(c)}</strong> <span className={`kind ${kind}`}>{KIND_LABEL[kind]}</span>{" "}
                  <span className="note">
                    <time dateTime={c.createdAt}>{fullDate(c.createdAt)}</time>
                    {wasEdited(c) && <span title={`Edited ${fullDate(c.updatedAt)}`}> · edited</span>}
                  </span>
                </p>
                {editing === c.id ? (
                  <form onSubmit={(e) => saveEdit(e, c)} className="edit">
                    <textarea
                      aria-label="Edit the comment"
                      rows={3}
                      maxLength={MAX_COMMENT_LENGTH}
                      value={edited}
                      autoFocus
                      onChange={(e) => setEdited(e.target.value)}
                    />
                    <span>
                      <button type="submit" disabled={pending || !edited.trim()}>Save</button>{" "}
                      <button type="button" className="link" onClick={() => setEditing(null)}>cancel</button>
                    </span>
                  </form>
                ) : (
                  <>
                    {/* Plain text in a text node: React escapes it, so markup shows as typed and never runs. */}
                    <p className="body">{c.body}</p>
                    {c.ownerId === userId && (
                      <p className="comment-actions">
                        {/* Only a person's comment is edited here: editing an AI one would relabel it Human (core/comments.ts). */}
                        {kind === "human" && (
                          <>
                            <button type="button" className="link" disabled={pending} onClick={() => { setEditing(c.id); setEdited(c.body); }}>
                              edit
                            </button>{" "}
                          </>
                        )}
                        <button type="button" className="link" disabled={pending} onClick={() => run(() => deleteComment(c.id))}>
                          delete
                        </button>
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={post} className="add-comment" aria-label={`Comment on "${taskTitle}"`}>
        <textarea
          aria-label={`New comment on "${taskTitle}"`}
          placeholder="Write a comment"
          rows={3}
          maxLength={MAX_COMMENT_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span>
          <button type="submit" disabled={pending || !draft.trim()}>Post</button>
        </span>
      </form>
    </section>
  );
}

/** What the thread says when the filter hides every comment. */
function noMatch(filter: CommentFilter): string {
  const words = filter.text.trim();
  if (filter.kind === "both") return `No comments match “${words}”.`;
  const kind = `${KIND_LABEL[filter.kind]} comments`;
  return words ? `No comments match “${words}” among ${kind}.` : `No comments match: there are no ${kind} on this task yet.`;
}

/** Saved again more than a few seconds after it was posted. */
function wasEdited(c: TaskComment): boolean {
  return new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 5000;
}
