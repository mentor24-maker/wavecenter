"use client";

/**
 * The Proposals table: every member's proposals with their status, priority,
 * points, and who made each and when. Add proposal opens a form for a new
 * one; on the member's own proposals, Edit and Delete. Every change is a
 * server action that goes through core (app/proposals/actions.ts); the
 * database still refuses a change to someone else's proposal.
 *
 * Every save waits for the server's answer. A refused save keeps what was
 * typed and says why, including when the network is down and the server
 * never answered; nothing is called saved unless the database took it
 * (engineering rule 6). An empty table says why it is empty (rule 7).
 */
import { Fragment, useId, useState, useTransition, type FormEvent } from "react";
import { PROPOSAL_STATUSES, type ProposalStatus } from "../../core/proposals.ts";
import { TASK_PRIORITIES, type TaskPriority } from "../../core/tasks.ts";
import { fullDate, PRIORITY_LABEL, shortDate } from "../tasks/listView.ts";
import { addProposal, editProposal, removeProposal, type ProposalFields, type ProposalSaveResult } from "./actions";

export interface ListProposal {
  id: string;
  title: string;
  notes: string | null;
  status: ProposalStatus;
  points: number;
  priority: TaskPriority;
  createdAt: string;
  mine: boolean;
  /** "you", or how another member is named. */
  owner: string;
}

const STATUS_LABEL: Record<ProposalStatus, string> = { todo: "To do", doing: "Doing", done: "Done" };

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again; what you typed is still here.";

/** Run a server action, turning a lost connection into a plain failure. */
async function attempt(action: () => Promise<ProposalSaveResult>): Promise<ProposalSaveResult> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export default function ProposalList({ proposals }: { proposals: ListProposal[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const columns = 6;

  return (
    <div className="panel">
      <div className="title-row">
        <h2>Every proposal</h2>
        {!adding && (
          <button type="button" onClick={() => { setAdding(true); setNotice(null); }}>Add proposal</button>
        )}
      </div>
      {notice && <p className="note" role="status">{notice}</p>}
      {adding && (
        <ProposalForm
          heading="Add a proposal"
          initial={{ title: "", notes: "", points: 0, priority: "normal" }}
          submitLabel="Add proposal"
          save={(fields) => addProposal(fields)}
          onDone={(saved) => { setAdding(false); if (saved) setNotice("Proposal added."); }}
        />
      )}

      {proposals.length === 0 ? (
        <p className="note" role="status">
          No proposals yet: nobody has proposed a change. Click Add proposal to make the first one.
        </p>
      ) : (
        <table className="game members proposals">
          <thead>
            <tr>
              <th scope="col">Proposal</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col" className="num">Points</th>
              <th scope="col">Made</th>
              <th scope="col" className="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <Fragment key={p.id}>
                {editing === p.id ? (
                  <tr>
                    <td colSpan={columns}>
                      <ProposalForm
                        heading={`Edit “${p.title}”`}
                        initial={{ title: p.title, notes: p.notes ?? "", points: p.points, priority: p.priority, status: p.status }}
                        submitLabel="Save changes"
                        save={(fields) => editProposal(p.id, fields)}
                        onDone={(saved) => { setEditing(null); if (saved) setNotice(`“${p.title}”: changes saved.`); }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td>
                      <b>{p.title}</b>
                      {p.notes && <span className="note block">{p.notes}</span>}
                    </td>
                    <td>{STATUS_LABEL[p.status]}</td>
                    <td>{PRIORITY_LABEL[p.priority]}</td>
                    <td className="num">{p.points} <span className="note">pts</span></td>
                    <td className="note">
                      <time dateTime={p.createdAt} title={fullDate(p.createdAt)}>{shortDate(p.createdAt)}</time>
                      <span className="block">by {p.owner}</span>
                    </td>
                    <td className="member-actions">
                      {p.mine ? (
                        <RowActions
                          proposal={p}
                          onEdit={() => { setEditing(p.id); setNotice(null); }}
                          onDeleted={() => setNotice(`“${p.title}” deleted.`)}
                        />
                      ) : (
                        <span className="note" title={`Only ${p.owner} can change this proposal`}>—</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The fields of a proposal. A refused save keeps what was typed and says why. */
function ProposalForm({
  heading,
  initial,
  submitLabel,
  save,
  onDone,
}: {
  heading: string;
  initial: ProposalFields;
  submitLabel: string;
  save: (fields: ProposalFields) => Promise<ProposalSaveResult>;
  onDone: (saved: boolean) => void;
}) {
  const [fields, setFields] = useState(initial);
  const [pointsText, setPointsText] = useState(String(initial.points));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const points = pointsText.trim() === "" ? 0 : Number(pointsText);
    startTransition(async () => {
      const result = await attempt(() => save({ ...fields, points }));
      if (result.ok) onDone(true);
      else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <form className="stack proposal-form" onSubmit={submit} aria-label={heading} noValidate>
      <h3>{heading}</h3>
      <label htmlFor={`${id}-title`}>Title</label>
      <input id={`${id}-title`} required value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
      <label htmlFor={`${id}-notes`}>Details (optional)</label>
      <textarea id={`${id}-notes`} rows={3} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.target.value })} />
      <div className="line">
        <label htmlFor={`${id}-points`}>Points</label>{" "}
        <input id={`${id}-points`} className="points" type="number" min="0" step="1" inputMode="numeric" value={pointsText}
          onChange={(e) => setPointsText(e.target.value)} />{" "}
        <label htmlFor={`${id}-priority`}>Priority</label>{" "}
        <select id={`${id}-priority`} value={fields.priority} onChange={(e) => setFields({ ...fields, priority: e.target.value as TaskPriority })}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
        {fields.status && (
          <>
            {" "}
            <label htmlFor={`${id}-status`}>Status</label>{" "}
            <select id={`${id}-status`} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value as ProposalStatus })}>
              {PROPOSAL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="line">
        <button type="submit" disabled={pending || !fields.title.trim()}>{pending ? "Saving…" : submitLabel}</button>{" "}
        <button type="button" className="link" disabled={pending} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** Edit and Delete for one of the member's own proposals. Delete asks once more before it goes. */
function RowActions({ proposal, onEdit, onDeleted }: { proposal: ListProposal; onEdit: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => removeProposal(proposal.id));
      if (result.ok) onDeleted();
      else {
        setConfirming(false);
        setError(`Not deleted. ${result.error}`);
      }
    });
  }

  return (
    <>
      {confirming ? (
        <>
          <span className="note block">Delete &ldquo;{proposal.title}&rdquo;?</span>
          <button type="button" className="link" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Yes, delete"}</button>{" "}
          <button type="button" className="link" disabled={pending} onClick={() => setConfirming(false)}>Keep it</button>
        </>
      ) : (
        <>
          <button type="button" className="link" aria-label={`Edit “${proposal.title}”`} onClick={onEdit}>Edit</button>{" "}
          <button type="button" className="link" aria-label={`Delete “${proposal.title}”`} onClick={() => { setConfirming(true); setError(null); }}>Delete</button>
        </>
      )}
      {error && <span className="error block" role="alert">{error}</span>}
    </>
  );
}
