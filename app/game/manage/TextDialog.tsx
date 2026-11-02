"use client";

/**
 * The pop-up for one text cell of the Game Manager: a large text box with
 * Save and Cancel. It opens when it is shown and tells its row when it shuts.
 * `onSave` returns null when the text was taken, or the plain reason it was
 * not; on a refusal the box stays open with what was typed (engineering
 * rule 6). Cancel, Escape and the backdrop change nothing.
 */
import { useEffect, useRef, useState, useTransition, type FormEvent, type SyntheticEvent } from "react";

export default function TextDialog({
  title,
  value,
  maxLength,
  saveLabel = "Save",
  onSave,
  onClose,
}: {
  title: string;
  value: string;
  maxLength?: number;
  saveLabel?: string;
  onSave: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  function close() {
    if (!pending) dialog.current?.close();
  }

  // The browser shuts a dialog on Escape by itself. Refuse while a save is
  // under way, so its result always lands on a box the admin can read.
  function onCancel(e: SyntheticEvent) {
    if (pending) e.preventDefault();
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const refused = await onSave(text);
      if (refused === null) dialog.current?.close();
      else setError(refused);
    });
  }

  return (
    <dialog ref={dialog} className="text-dialog" aria-label={title} onCancel={onCancel} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <h2>{title}</h2>
        <textarea
          rows={14}
          value={text}
          maxLength={maxLength}
          autoFocus
          readOnly={pending}
          aria-label={title}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {maxLength !== undefined && (
          <p className="note">{text.length} of {maxLength} characters</p>
        )}
        {pending && <p className="note" role="status">Saving…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="buttons">
          <button type="submit" disabled={pending}>{saveLabel}</button>
          <button type="button" className="quiet" onClick={close} disabled={pending}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
