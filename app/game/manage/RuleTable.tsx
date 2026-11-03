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
 *
 * Each row also has the action's four factor scores as dropdowns
 * (FactorCell), whose options read the plain tests from
 * docs/GRANULAR_SCORING_ALGORITHM.md. Choosing the fourth saves them
 * (saveScoringFactors); they change no points until the Admin page's
 * "Recalculate action points" is put live. Beside each dropdown, "why"
 * opens the one-sentence reason for that score in a pop-up (TextDialog),
 * saved on its own (saveFactorReason). The Admin page's Recalculate pop-ups
 * show the same text. A new action takes its reasons too, all optional.
 */
import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { FACTOR_KEYS, FACTOR_TESTS, type FactorKey, type ScoringRule } from "../../../core/game.ts";
import { addScoringAction, saveFactorReason, saveScoringFactors, saveScoringRule } from "./actions";
import TextDialog from "./TextDialog";
import {
  BLANK_FACTORS,
  BLANK_FORM,
  BLANK_REASONS,
  FIELD_LABELS,
  FIELD_MAX,
  REASON_BOX_MAX,
  TEXT_FIELDS,
  factorFormOf,
  factorFormState,
  factorOptions,
  factorsFromForm,
  formWith,
  formulaFor,
  isChanged,
  reasonButtonLabel,
  reasonFormOf,
  reasonsFromForm,
  type FactorForm,
  type ReasonForm,
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
      <td colSpan={7}>
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      </td>
    </tr>
  );
}

/**
 * The four factor dropdowns, each with its reason button, and what the
 * formula gives once all four are chosen. `children` is the open reason
 * pop-up, if any.
 */
function FactorCell({
  form,
  reasons,
  label,
  disabled,
  onChange,
  onReason,
  children,
}: {
  form: FactorForm;
  reasons: ReasonForm;
  label: string;
  disabled?: boolean;
  onChange: (key: FactorKey, value: string) => void;
  onReason: (key: FactorKey) => void;
  children?: ReactNode;
}) {
  const formula = formulaFor(form);
  return (
    <td className="col-factors">
      {FACTOR_KEYS.map((k) => {
        const why = reasonButtonLabel(k, label, reasons[k]);
        return (
          <div key={k} className="factor">
            <label>
              <span title={FACTOR_TESTS[k].name}>{FACTOR_TESTS[k].letter}</span>
              <select value={form[k]} aria-label={`${FACTOR_TESTS[k].name} of ${label}`} disabled={disabled} onChange={(e) => onChange(k, e.target.value)}>
                <option value="">–</option>
                {factorOptions(k).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className={`factor-reason${reasons[k].trim() ? "" : " empty"}`} aria-label={why} title={why} onClick={() => onReason(k)} disabled={disabled}>
              why
            </button>
          </div>
        );
      })}
      <span className="note block">
        {formula !== null ? `Formula: ${formula}` : factorFormState(form) === "none" ? "Not scored yet" : "Choose all four"}
      </span>
      {children}
    </td>
  );
}

/** The pop-up for one factor's reason: TextDialog, held to core's limit. */
function ReasonDialog({ factor, of, value, saveLabel, onSave, onClose }: {
  factor: FactorKey;
  of: string;
  value: string;
  saveLabel?: string;
  onSave: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  return (
    <TextDialog
      title={`Why ${of} has its ${FACTOR_TESTS[factor].name} score`}
      value={value}
      maxLength={REASON_BOX_MAX}
      saveLabel={saveLabel}
      onSave={onSave}
      onClose={onClose}
    />
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
  const [factors, setFactors] = useState<FactorForm>(() => factorFormOf(stored));
  const [reasonPopup, setReasonPopup] = useState<FactorKey | null>(null);
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

  /** Choosing a factor saves once all four are chosen, or all are cleared; never some. */
  function chooseFactor(key: FactorKey, value: string) {
    if (pending) return;
    const next = { ...factors, [key]: value };
    setFactors(next);
    if (factorFormState(next) === "some") {
      setMessage({ ok: true, text: `Choose all four factors of "${rule.name}" to save them, or set them all back to – to clear them.` });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveScoringFactors(rule.kind, factorsFromForm(next));
        if (!result.ok) {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
          return;
        }
        setRule(result.rule);
        setFactors(factorFormOf(result.rule));
        setMessage({
          ok: true,
          text: `Saved. The factors of "${result.rule.name}" are ${result.rule.factors ? "changed" : "cleared"}. Its points change only when an admin puts the Admin page's recalculation live.`,
        });
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  /** Save one factor's reason from its pop-up. Returns null when the database took it, or the plain reason it did not. */
  async function saveReason(key: FactorKey, typed: string): Promise<string | null> {
    if (reasonFormOf(rule)[key].trim() === typed.trim()) return null;
    try {
      const result = await saveFactorReason(rule.kind, key, typed);
      if (!result.ok) return `Not saved. ${result.error}`;
      setRule(result.rule);
      const name = FACTOR_TESTS[key].name;
      setMessage({ ok: true, text: `Saved. The ${name} reason of "${result.rule.name}" is ${result.rule.reasons?.[key] ? "changed" : "cleared"}.` });
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
        <FactorCell form={factors} reasons={reasonFormOf(rule)} label={rule.name} disabled={pending} onChange={chooseFactor} onReason={setReasonPopup}>
          {reasonPopup && (
            <ReasonDialog
              factor={reasonPopup}
              of={rule.name}
              value={reasonFormOf(rule)[reasonPopup]}
              onSave={(text) => saveReason(reasonPopup, text)}
              onClose={() => setReasonPopup(null)}
            />
          )}
        </FactorCell>
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
  const [factors, setFactors] = useState<FactorForm>(BLANK_FACTORS);
  const [reasons, setReasons] = useState<ReasonForm>(BLANK_REASONS);
  const [popup, setPopup] = useState<RuleField | null>(null);
  const [reasonPopup, setReasonPopup] = useState<FactorKey | null>(null);
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
        const result = await addScoringAction(form, factorsFromForm(factors), reasonsFromForm(reasons));
        if (result.ok) {
          setForm(BLANK_FORM);
          setFactors(BLANK_FACTORS);
          setReasons(BLANK_REASONS);
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
        <FactorCell
          form={factors}
          reasons={reasons}
          label="the new action"
          disabled={pending}
          onChange={(key, value) => {
            setFactors((f) => ({ ...f, [key]: value }));
            setMessage(null);
          }}
          onReason={setReasonPopup}
        >
          {reasonPopup && (
            <ReasonDialog
              factor={reasonPopup}
              of="the new action"
              value={reasons[reasonPopup]}
              saveLabel="Use this text"
              onSave={async (text) => {
                setReasons((r) => ({ ...r, [reasonPopup]: text }));
                setMessage(null);
                return null;
              }}
              onClose={() => setReasonPopup(null)}
            />
          )}
        </FactorCell>
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
