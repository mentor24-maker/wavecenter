"use client";

/**
 * The Game Manager's table rows. A rule's row shows each part as a cell;
 * clicking Name, Points, Description or What counts turns that cell into a
 * box in place. Enter or leaving the cell saves, Escape puts it back. Each
 * text cell also has an expand button that opens the same text in a large
 * pop-up (TextDialog).
 *
 * Every save goes through the server (saveScoringRule, then core's
 * changeScoringRule) and says "Saved" only when the database took it. A
 * refused or failed save keeps what was typed and says plainly that nothing
 * was saved, and why (engineering rule 6).
 *
 * The last row adds a new action (addScoringAction), which the page then
 * lists, not active yet.
 */
import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import type { ScoringRule } from "../../../core/game.ts";
import { addScoringAction, saveScoringRule } from "./actions";
import TextDialog from "./TextDialog";
import {
  BLANK_FORM,
  FIELD_LABELS,
  FIELD_MAX,
  TEXT_FIELDS,
  formWith,
  isChanged,
  type RuleField,
  type RuleFormValues,
} from "./ruleTableView";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";

type Message = { ok: boolean; text: string } | null;

function ExpandButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="icon-button expand" aria-label={label} title="Open in a large box" onClick={onClick} disabled={disabled}>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      </svg>
    </button>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <tr className="rule-message">
      <td colSpan={6}>
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      </td>
    </tr>
  );
}

/** One scoring rule as a table row, every part but its kind editable in place. */
export function RuleRow({ rule: stored, active, detail }: { rule: ScoringRule; active: boolean; detail: ReactNode }) {
  const [rule, setRule] = useState(stored);
  const [editing, setEditing] = useState<RuleField | null>(null);
  const [draft, setDraft] = useState("");
  const [popup, setPopup] = useState<RuleField | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  // Escape unmounts the box; a blur that follows must not save it.
  const cancelled = useRef(false);

  /** Save one cell. Returns null when the database took it, or the plain reason it did not. */
  async function save(field: RuleField, typed: string): Promise<string | null> {
    if (!isChanged(rule, field, typed)) return null;
    try {
      const result = await saveScoringRule(rule.kind, formWith(rule, field, typed));
      if (!result.ok) return `Not saved. ${result.error}`;
      setRule(result.rule);
      setMessage({ ok: true, text: `Saved. ${FIELD_LABELS[field]} of "${result.rule.name}" is changed.` });
      return null;
    } catch {
      return UNREACHABLE;
    }
  }

  function start(field: RuleField) {
    if (pending) return;
    cancelled.current = false;
    setDraft(field === "points" ? String(rule.points) : rule[field]);
    setEditing(field);
    setMessage(null);
  }

  function commit() {
    const field = editing;
    if (!field || pending || cancelled.current) return;
    if (!isChanged(rule, field, draft)) {
      setEditing(null);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const refused = await save(field, draft);
      if (refused === null) setEditing(null);
      else setMessage({ ok: false, text: refused });
    });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      setEditing(null);
      setMessage(null);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
  }

  function cell(field: RuleField) {
    const label = `${FIELD_LABELS[field]} of ${rule.name}`;
    const shown = field === "points" ? String(rule.points) : rule[field];
    const isText = TEXT_FIELDS.includes(field);
    const box = { value: draft, autoFocus: true, readOnly: pending, "aria-label": label, onKeyDown: onKey, onBlur: commit };
    return (
      <td className={`rule-cell col-${field}`}>
        <div className="rule-cell-inner">
          {editing === field ? (
            field === "points" ? (
              <input type="text" inputMode="numeric" {...box} onChange={(e) => setDraft(e.target.value)} />
            ) : field === "name" ? (
              <input type="text" maxLength={FIELD_MAX.name} {...box} onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <textarea rows={3} maxLength={FIELD_MAX[field]} {...box} onChange={(e) => setDraft(e.target.value)} />
            )
          ) : (
            <button type="button" className="cell-edit" title="Click to change" aria-label={`Change ${label}: ${shown || "empty"}`} onClick={() => start(field)} disabled={pending}>
              {shown || <span className="note">Empty, click to add</span>}
            </button>
          )}
          {isText && <ExpandButton label={`Open ${label} in a large box`} onClick={() => setPopup(field)} disabled={pending} />}
        </div>
      </td>
    );
  }

  return (
    <>
      <tr className="rule-row">
        {cell("name")}
        <td className="col-kind"><code>{rule.kind}</code></td>
        {cell("points")}
        {cell("description")}
        {cell("criteria")}
        <td className="col-status">
          {active ? <span>Active</span> : <span className="badge">Not active yet</span>}
          <details className="rule-detail">
            <summary>{active ? "How it is recorded" : "Why not"}</summary>
            {detail}
          </details>
          {popup && (
            <TextDialog
              title={`${FIELD_LABELS[popup]} of ${rule.name}`}
              value={editing === popup ? draft : String(rule[popup])}
              maxLength={FIELD_MAX[popup]}
              onSave={async (text) => {
                const refused = await save(popup, text);
                if (refused === null && editing === popup) setEditing(null);
                return refused;
              }}
              onClose={() => setPopup(null)}
            />
          )}
        </td>
      </tr>
      <MessageRow message={message} />
    </>
  );
}

/** The table's last row: a blank action to fill in and add. */
export function NewRuleRow() {
  const [form, setForm] = useState<RuleFormValues>(BLANK_FORM);
  const [popup, setPopup] = useState<RuleField | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const set = (field: RuleField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setMessage(null);
  };

  function add() {
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await addScoringAction(form);
        if (result.ok) {
          setForm(BLANK_FORM);
          setMessage({ ok: true, text: `Added "${result.rule.name}". It is in the table above, marked Not active yet.` });
        } else {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  }

  function textCell(field: RuleField) {
    const label = `${FIELD_LABELS[field]} of the new action`;
    return (
      <td className={`rule-cell col-${field}`}>
        <div className="rule-cell-inner">
          {field === "name" ? (
            <input type="text" maxLength={FIELD_MAX.name} value={form.name} placeholder="New action's name" aria-label={label} readOnly={pending} onKeyDown={onKey} onChange={(e) => set(field, e.target.value)} />
          ) : (
            <textarea rows={2} maxLength={FIELD_MAX[field]} value={form[field]} aria-label={label} readOnly={pending} onKeyDown={onKey} onChange={(e) => set(field, e.target.value)} />
          )}
          <ExpandButton label={`Open ${label} in a large box`} onClick={() => setPopup(field)} disabled={pending} />
        </div>
      </td>
    );
  }

  return (
    <>
      <tr className="rule-row rule-new">
        {textCell("name")}
        <td className="col-kind note">Made from the name</td>
        <td className="rule-cell col-points">
          <input type="text" inputMode="numeric" value={form.points} aria-label="Points of the new action" readOnly={pending} onKeyDown={onKey} onChange={(e) => set("points", e.target.value)} />
        </td>
        {textCell("description")}
        {textCell("criteria")}
        <td className="col-status">
          <button type="button" onClick={add} disabled={pending}>Add action</button>
          {pending && <span className="note"> Saving…</span>}
          {popup && (
            <TextDialog
              title={`${FIELD_LABELS[popup]} of the new action`}
              value={form[popup]}
              maxLength={FIELD_MAX[popup]}
              saveLabel="Use this text"
              onSave={async (text) => {
                set(popup, text);
                return null;
              }}
              onClose={() => setPopup(null)}
            />
          )}
        </td>
      </tr>
      <MessageRow message={message} />
    </>
  );
}
