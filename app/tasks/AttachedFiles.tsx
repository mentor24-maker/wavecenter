"use client";

/**
 * A row of attached files, on a task or on a Discussion comment: a picture
 * shows as a small thumbnail that opens it, any other file as a download
 * link. Each link is short-lived and signed, as the bucket is private.
 */
import { removeAttachment, type SaveResult } from "./actions";
import type { ListFile } from "./TaskList";

export default function AttachedFiles({
  files,
  removable,
  pending,
  run,
}: {
  files: ListFile[];
  /** The signed-in member's own files, so they may remove them. */
  removable: boolean;
  pending: boolean;
  run: (action: () => Promise<SaveResult>) => Promise<boolean>;
}) {
  return (
    <ul className="files">
      {files.map((f) => (
        <li key={f.id}>
          {!f.url ? (
            <span className="note">{f.name} (no link could be made; try reloading)</span>
          ) : f.image ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.name}>
              {/* A signed link to a private file: plain <img>, not next/image, which would fetch it through the web server. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.name} className="thumb" />
            </a>
          ) : (
            <a href={f.url}>{f.name}</a>
          )}
          {removable && (
            <button type="button" className="link" aria-label={`Remove "${f.name}"`} disabled={pending} onClick={() => run(() => removeAttachment(f.id))}>
              remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
