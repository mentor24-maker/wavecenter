"use client";

/**
 * Game Manager's Tokens section: one row per token size (the coloured discs
 * the earned-points animation will use), each with its colour swatch, its
 * size in pixels and its point level, and Edit and Remove. The last row adds
 * a size. Preview plays the earned-points animation at that size and colour
 * in the header (app/TokenAnimation.tsx); it changes nobody's points.
 *
 * Every save goes through the server (saveTokenSize, deleteTokenSize, then
 * core's rules in core/tokens.ts) and says "Saved" only when the database
 * took it. A refused or failed save keeps what was typed and says plainly
 * that nothing was saved, and why (engineering rule 6).
 */
import { useState, useTransition, type FormEvent } from "react";
import { TOKEN_DIAMETER_MAX, TOKEN_DIAMETER_MIN, TOKEN_NAME_MAX, type TokenSize } from "../../../core/tokens.ts";
import { playToken } from "../../TokenAnimation";
import { deleteTokenSize, saveTokenSize, type TokenForm } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";
const BLANK: TokenForm = { name: "", diameter: "20", color: "#005f80", minPoints: "" };

type Message = { ok: boolean; text: string } | null;

function formOf(size: TokenSize): TokenForm {
  return { name: size.name, diameter: String(size.diameter), color: size.color, minPoints: String(size.minPoints) };
}

function Swatch({ color, diameter }: { color: string; diameter: number }) {
  return <span className="token-swatch" style={{ background: color, width: diameter, height: diameter }} aria-hidden="true" />;
}

function MessageRow({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <tr className="token-message">
      <td colSpan={5}>
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      </td>
    </tr>
  );
}

/** The boxes for one size, in place of its row. */
function EditRow({ formId, form, setForm, label, saveLabel, pending, onSave, onCancel }: {
  formId: string;
  form: TokenForm;
  setForm: (form: TokenForm) => void;
  label: string;
  saveLabel: string;
  pending: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const diameter = Number(form.diameter);
  const preview = Number.isInteger(diameter) && diameter >= TOKEN_DIAMETER_MIN && diameter <= TOKEN_DIAMETER_MAX ? diameter : 20;
  function submit(e: FormEvent) {
    e.preventDefault();
    onSave();
  }
  return (
    <tr className="token-edit">
      <td>
        <input type="text" value={form.name} maxLength={TOKEN_NAME_MAX} aria-label={`Name of ${label}`} placeholder="Name" readOnly={pending}
          onChange={(e) => setForm({ ...form, name: e.target.value })} form={formId} />
      </td>
      <td>
        <span className="token-colour">
          <Swatch color={form.color} diameter={preview} />
          <input type="color" value={form.color} aria-label={`Colour of ${label}`} disabled={pending}
            onChange={(e) => setForm({ ...form, color: e.target.value })} form={formId} />
        </span>
      </td>
      <td>
        <input type="number" inputMode="numeric" min={TOKEN_DIAMETER_MIN} max={TOKEN_DIAMETER_MAX} step={1} value={form.diameter} aria-label={`Size in pixels of ${label}`} readOnly={pending}
          onChange={(e) => setForm({ ...form, diameter: e.target.value })} form={formId} /> px
      </td>
      <td>
        <input type="number" inputMode="numeric" min={1} step={1} value={form.minPoints} aria-label={`Point level of ${label}`} placeholder="Points" readOnly={pending}
          onChange={(e) => setForm({ ...form, minPoints: e.target.value })} form={formId} /> +
      </td>
      <td>
        <form id={formId} onSubmit={submit} noValidate className="token-buttons">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : saveLabel}</button>
          {onCancel && <button type="button" className="quiet" onClick={onCancel} disabled={pending}>Cancel</button>}
        </form>
      </td>
    </tr>
  );
}

function SizeRow({ size }: { size: TokenSize }) {
  const [form, setForm] = useState<TokenForm | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!form) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveTokenSize(size.id, form);
        if (result.ok) {
          setForm(null);
          setMessage({ ok: true, text: `Saved "${result.size.name}".` });
        } else {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  function remove() {
    if (!window.confirm(`Remove the token size "${size.name}"?`)) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await deleteTokenSize(size.id);
        if (!result.ok) setMessage({ ok: false, text: `Not removed. ${result.error}` });
      } catch {
        setMessage({ ok: false, text: "Could not reach WaveCenter, so nothing was removed. Check your connection and try again." });
      }
    });
  }

  return (
    <>
      {form ? (
        <EditRow formId={`token-${size.id}`} form={form} setForm={(f) => { setForm(f); setMessage(null); }} label={size.name} saveLabel="Save" pending={pending} onSave={save}
          onCancel={() => { setForm(null); setMessage(null); }} />
      ) : (
        <tr>
          <th scope="row">{size.name}</th>
          <td>
            <span className="token-colour">
              <Swatch color={size.color} diameter={size.diameter} />
              <code>{size.color}</code>
            </span>
          </td>
          <td>{size.diameter} px</td>
          <td>{size.minPoints}+ points</td>
          <td className="token-buttons">
            <button type="button" className="quiet" aria-label={`Preview ${size.name}`} onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              playToken({ points: size.minPoints, sizes: [size], from: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, preview: true });
            }}>Preview</button>
            <button type="button" className="quiet" onClick={() => { setForm(formOf(size)); setMessage(null); }} disabled={pending}>Edit</button>
            <button type="button" className="quiet" onClick={remove} disabled={pending}>{pending ? "Removing…" : "Remove"}</button>
          </td>
        </tr>
      )}
      <MessageRow message={message} />
    </>
  );
}

function NewSizeRow() {
  const [form, setForm] = useState<TokenForm | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!form) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveTokenSize(null, form);
        if (result.ok) {
          setForm(null);
          setMessage({ ok: true, text: `Added "${result.size.name}".` });
        } else {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <>
      {form ? (
        <EditRow formId="token-new" form={form} setForm={(f) => { setForm(f); setMessage(null); }} label="the new size" saveLabel="Save" pending={pending} onSave={save}
          onCancel={() => { setForm(null); setMessage(null); }} />
      ) : (
        <tr>
          <td colSpan={5}>
            <button type="button" onClick={() => { setForm(BLANK); setMessage(null); }}>Add size</button>
          </td>
        </tr>
      )}
      <MessageRow message={message} />
    </>
  );
}

export default function TokenTable({ sizes }: { sizes: TokenSize[] }) {
  return (
    <div className="rule-table-wrap">
      <table className="game token-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Colour</th>
            <th scope="col">Size</th>
            <th scope="col">Point level</th>
            <th scope="col"><span className="sr-only">Change</span></th>
          </tr>
        </thead>
        <tbody>
          {!sizes.length && (
            <tr>
              <td colSpan={5}>
                <p className="note" role="status">
                  There are no token sizes: every one has been removed, so the earned-points animation has no disc to
                  show. Add at least one size below.
                </p>
              </td>
            </tr>
          )}
          {sizes.map((s) => <SizeRow key={s.id} size={s} />)}
          <NewSizeRow />
        </tbody>
      </table>
    </div>
  );
}
