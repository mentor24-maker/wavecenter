/**
 * Sending files from the browser: to a task, or to one of its Discussion
 * comments. Shared by the task list and the Discussion thread
 * (app/tasks/actions.ts explains the three steps of an upload).
 */
import type { ChangeEvent } from "react";
import { checkFile } from "../../core/files.ts";
import { finishUpload, startUpload, type SaveResult } from "./actions";

export const UNREACHABLE =
  "Could not reach WaveCenter, so this was not saved. Check your connection and try again; what you typed is still here.";

/**
 * Attach files to a task, or to a comment on it, one after another. A file
 * over 10 MB is refused here, before anything is sent. Resolves ok only if
 * every file was attached; otherwise the answer names what failed, and a
 * failed file leaves nothing behind.
 */
export async function uploadFiles(taskId: string, files: File[], commentId: string | null = null): Promise<SaveResult> {
  const problems: string[] = [];
  for (const file of files) {
    const result = await uploadFile(taskId, file, commentId).catch((): SaveResult => ({ ok: false, error: UNREACHABLE }));
    if (!result.ok) problems.push(result.error);
  }
  if (!problems.length) return { ok: true };
  const attached = files.length - problems.length;
  return { ok: false, error: `${attached ? `${attached} of ${files.length} files were attached. ` : ""}${problems.join(" ")}` };
}

async function uploadFile(taskId: string, file: File, commentId: string | null): Promise<SaveResult> {
  try {
    checkFile(file.name, file.size);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const ticket = await startUpload(taskId, file.name, file.size, commentId);
  if (!ticket.ok) return ticket;
  const notSent = `"${file.name}" could not be sent to file storage, so it was not attached. Check your connection and try again.`;
  try {
    const sent = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!sent.ok) return { ok: false, error: `File storage refused "${file.name}" (error ${sent.status}), so it was not attached. Try again.` };
  } catch {
    return { ok: false, error: notSent };
  }
  return finishUpload({ taskId, path: ticket.path, name: file.name, contentType: file.type, sizeBytes: file.size, commentId });
}

/** The files picked in a file box, then the box emptied so the same file can be picked again. */
export function picked(e: ChangeEvent<HTMLInputElement>): File[] {
  const files = [...(e.target.files ?? [])];
  e.target.value = "";
  return files;
}

/**
 * Split picked files into those that may be sent and plain-words reasons for
 * the rest (a file over 10 MB is refused straight away, before any upload).
 */
export function screenFiles(chosen: File[]): { ok: File[]; refused: string[] } {
  const refused: string[] = [];
  const ok = chosen.filter((f) => {
    try {
      checkFile(f.name, f.size);
      return true;
    } catch (err) {
      refused.push((err as Error).message);
      return false;
    }
  });
  return { ok, refused };
}
