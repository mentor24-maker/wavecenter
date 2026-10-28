/**
 * A task's Discussion: a thread of comments, oldest first, where the story of
 * the task is told (Dane, 2026-10-27). The only path for adding, editing and
 * removing a comment, and the one place that decides whether a comment
 * counts as written by a person or by AI, so the screen and any later agent
 * path cannot disagree.
 *
 * A comment is written in a small rich-text format (bold, italic, lists and
 * links; core/richText.ts). It is never treated as HTML, so nothing typed
 * into one can run in the browser.
 *
 * Core does not know about Supabase. It talks to a `TaskCommentStore`, which a
 * client supplies, and to the same `TaskStore` as core/tasks.ts. The
 * plain-words description of the table is docs/DATA_MODEL.md.
 */
import { CoreError, requireTool, WAVECENTER_TOOL } from './tool.ts';
import type { TaskStore } from './tasks.ts';
import { richTextSearchable } from './richText.ts';

/** The longest comment a member may post: 10,000 characters. The table checks the same. */
export const MAX_COMMENT_LENGTH = 10_000;

/** One row of `task_comments`, in core's own names. */
export interface TaskComment {
  id: string;
  taskId: string;
  /** The member it belongs to. */
  ownerId: string;
  body: string;
  /** The tool that wrote it, or last edited it. */
  tool: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields a store writes for a new comment. The owner is the signed-in member. */
export interface NewTaskCommentRow {
  taskId: string;
  body: string;
  tool: string;
}

/**
 * What core needs from storage: the `task_comments` rows. An adapter
 * translates these calls and decides nothing.
 */
export interface TaskCommentStore {
  insert(row: NewTaskCommentRow): Promise<TaskComment>;
  get(id: string): Promise<TaskComment | null>;
  /** Change a comment's words on behalf of `tool`. Returns null if there is no such comment the caller may change. */
  update(id: string, body: string, tool: string): Promise<TaskComment | null>;
  /** Delete one comment. Returns false if there is no such comment the caller may delete. */
  remove(id: string): Promise<boolean>;
}

/** Who wrote a comment: a person, through WaveCenter's own app, or an AI agent, through any other tool. */
export type CommentAuthorKind = 'human' | 'ai';

/**
 * Whether a comment counts as written by a person or by AI. A person writes
 * through WaveCenter's own screens (the tool `wavecenter`); anything written
 * through another tool counts as AI.
 */
export function commentAuthorKind(comment: Pick<TaskComment, 'tool'>): CommentAuthorKind {
  return comment.tool === WAVECENTER_TOOL ? 'human' : 'ai';
}

/** Returns the words trimmed, or throws if they are blank or too long. */
export function checkCommentBody(body: unknown): string {
  if (typeof body !== 'string' || body.trim() === '') throw new CoreError('A comment needs some words, and it cannot be blank.');
  const trimmed = body.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new CoreError(
      `That comment is ${trimmed.length.toLocaleString('en-US')} characters, and comments can be at most ${MAX_COMMENT_LENGTH.toLocaleString('en-US')}. Nothing was saved.`,
    );
  }
  return trimmed;
}

/** Add a comment to one of the caller's own tasks (`TaskStore.get` returns only those), on behalf of `tool`. */
export async function addComment(tasks: TaskStore, comments: TaskCommentStore, taskId: string, body: unknown, tool: string): Promise<TaskComment> {
  const row: NewTaskCommentRow = { tool: requireTool(tool), body: checkCommentBody(body), taskId };
  if (!(await tasks.get(taskId))) throw new CoreError(`No task ${taskId} was found that you may comment on.`);
  return comments.insert(row);
}

/**
 * Change a comment's words on behalf of `tool`. A person's comment is edited
 * only through WaveCenter's own app, and an AI comment only by an AI tool, so
 * an edit can never change whether a comment counts as Human or AI.
 */
export async function editComment(comments: TaskCommentStore, id: string, body: unknown, tool: string): Promise<TaskComment> {
  const named = requireTool(tool);
  const words = checkCommentBody(body);
  const comment = await comments.get(id);
  if (!comment) throw new CoreError(`No comment ${id} was found that you may change.`);
  if (commentAuthorKind(comment) !== commentAuthorKind({ tool: named })) {
    throw new CoreError(
      commentAuthorKind(comment) === 'ai'
        ? 'That comment was written by AI, so it cannot be edited here; it would then look as if a person wrote it. You can delete it.'
        : 'That comment was written by a person, so an AI tool cannot edit it.',
    );
  }
  const saved = await comments.update(id, words, named);
  if (!saved) throw new CoreError(`No comment ${id} was found that you may change.`);
  return saved;
}

/** Remove one comment on behalf of `tool`. */
export async function removeComment(comments: TaskCommentStore, id: string, tool: string): Promise<void> {
  requireTool(tool);
  if (!(await comments.remove(id))) throw new CoreError(`No comment ${id} was found that you may remove.`);
}

/** The thread's filter bar: words to look for, and whose comments to show. */
export interface CommentFilter {
  text: string;
  kind: CommentAuthorKind | 'both';
}

export const NO_COMMENT_FILTER: CommentFilter = { text: '', kind: 'both' };

/**
 * The comments the filter lets through, oldest first. Every word typed must
 * appear in the comment's shown words (its marks left out) or the address of
 * one of its links, in any order, ignoring capitals.
 */
export function filterComments<C extends Pick<TaskComment, 'body' | 'tool' | 'createdAt'>>(comments: readonly C[], filter: CommentFilter): C[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return comments
    .filter((c) => filter.kind === 'both' || commentAuthorKind(c) === filter.kind)
    .filter((c) => {
      if (words.length === 0) return true;
      const body = richTextSearchable(c.body).toLowerCase();
      return words.every((w) => body.includes(w));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
