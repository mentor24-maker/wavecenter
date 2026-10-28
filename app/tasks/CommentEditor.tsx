"use client";

/**
 * The box a comment is written or edited in: a text box with a small toolbar
 * for bold, italic, bulleted and numbered lists and links, and a Preview that
 * shows the comment as it will look in the thread. The toolbar only types
 * the marks of core/richText.ts into the box, so what is saved is always
 * plain words.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MAX_COMMENT_LENGTH } from "../../core/comments.ts";
import { applyFormat, applyLink, type RichFormat, type TextEdit } from "../../core/richText.ts";
import RichText from "./RichText";

const BUTTONS: { format: RichFormat; label: string; title: string; shown: ReactNode }[] = [
  { format: "bold", label: "Bold", title: "Bold (Ctrl or ⌘ + B)", shown: <strong>B</strong> },
  { format: "italic", label: "Italic", title: "Italic (Ctrl or ⌘ + I)", shown: <em>I</em> },
  { format: "bullets", label: "Bulleted list", title: "Bulleted list", shown: "• List" },
  { format: "numbers", label: "Numbered list", title: "Numbered list", shown: "1. List" },
];

export default function CommentEditor({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [problem, setProblem] = useState("");

  /** Put the new words in the box and select what the change left selected. */
  function commit(next: TextEdit) {
    onChange(next.value);
    setProblem("");
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.start, next.end);
    });
  }

  function current(): TextEdit {
    const el = box.current;
    return { value, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  }

  function format(f: RichFormat) {
    commit(applyFormat(current(), f));
  }

  function link() {
    const edit = current();
    const url = window.prompt("Link to which address? (starts with https://, http:// or mailto:)", "https://");
    if (url === null || url.trim() === "" || url.trim() === "https://") return;
    const next = applyLink(edit, url);
    if (!next) {
      setProblem(`“${url.trim()}” cannot be a link. A link must start with https://, http:// or mailto:.`);
      return;
    }
    commit(next);
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "b" || key === "i") {
      e.preventDefault();
      format(key === "b" ? "bold" : "italic");
    } else if (key === "k") {
      e.preventDefault();
      link();
    }
  }

  return (
    <div className="comment-editor">
      <div className="toolbar" role="toolbar" aria-label={`Formatting for ${label}`}>
        {BUTTONS.map((b) => (
          <button key={b.format} type="button" aria-label={b.label} title={b.title} disabled={preview} onClick={() => format(b.format)}>
            {b.shown}
          </button>
        ))}
        <button type="button" aria-label="Link" title="Link (Ctrl or ⌘ + K)" disabled={preview} onClick={link}>
          Link
        </button>
        <button type="button" className="link preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>
          {preview ? "Back to writing" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="preview" aria-label={`Preview of ${label}`}>
          {value.trim() ? <RichText body={value} className="body" /> : <p className="note">Nothing written yet, so there is nothing to preview.</p>}
        </div>
      ) : (
        <textarea
          ref={box}
          aria-label={label}
          placeholder={placeholder}
          rows={3}
          maxLength={MAX_COMMENT_LENGTH}
          value={value}
          autoFocus={autoFocus}
          onKeyDown={keys}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {problem && <p className="error" role="alert">{problem}</p>}
    </div>
  );
}
