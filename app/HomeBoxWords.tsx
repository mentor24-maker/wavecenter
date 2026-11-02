"use client";

/**
 * The words in one of Home's editable boxes (core/homeBoxes.ts), drawn as
 * rich text. For a member whose role has `home.edit`, a small pencil in the
 * box's lower right opens the comment editor holding the words as they are,
 * with Save and Cancel. A save that fails says so and keeps what was typed
 * (engineering rule 6).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { HOME_BOX_MAX } from "../core/homeBoxes.ts";
import { saveHomeBoxAction } from "./homeActions";
import CommentEditor from "./tasks/CommentEditor";
import RichText from "./tasks/RichText";

export default function HomeBoxWords({
  box,
  name,
  words,
  editable,
}: {
  box: string;
  /** The box's heading, for the pencil's and the editor's labels. */
  name: string;
  words: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(words);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(words);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function open() {
    setDraft(shown);
    setError("");
    setEditing(true);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (draft.trim() === shown) return setEditing(false);
    startTransition(async () => {
      const result = await saveHomeBoxAction(box, draft);
      if (!result.ok) return setError(result.error);
      setShown(result.body);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form className="home-box-edit" onSubmit={save} aria-label={`Edit the words in ${name}`}>
        <CommentEditor label={`The words in ${name}`} value={draft} onChange={setDraft} maxLength={HOME_BOX_MAX} autoFocus />
        {error && <p className="error" role="alert">{error} What you typed is still in the box above.</p>}
        <span>
          <button type="submit" disabled={pending || !draft.trim()}>{pending ? "Saving…" : "Save"}</button>{" "}
          <button type="button" className="link" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
        </span>
      </form>
    );
  }

  return (
    <>
      {/* Drawn as React elements from text nodes: markup shows as typed and never runs. */}
      <RichText body={shown} className="home-box-words" />
      {editable && (
        <button type="button" className="home-box-pencil" aria-label={`Edit the words in ${name}`} title="Edit these words" onClick={open}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
            <path d="m13.5 6.5 4 4" />
          </svg>
        </button>
      )}
    </>
  );
}
