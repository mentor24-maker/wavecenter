"use client";

/**
 * The Team Manager table: every team with its slug, description and how many
 * members it has. Clicking a team's name opens its member list. A manager
 * (the page decides, from core's mayManageTeams) also gets Create team, and
 * Edit and Delete on each row, and adds and removes members; the database
 * still refuses a change the viewer may not make.
 *
 * Every save waits for the server's answer. A refused save keeps what was
 * typed and says why; nothing is called saved unless the database took it
 * (engineering rule 6).
 */
import { Fragment, useId, useState, useTransition, type FormEvent } from "react";
import { AVATARS } from "../../core/profiles.ts";
import { TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX, TEAM_SLUG_MAX, type Team, type TeamInput } from "../../core/teams.ts";
import {
  addTeamMemberAction, createTeamAction, deleteTeamAction, removeTeamMemberAction, updateTeamAction, type TeamSaveResult,
} from "./actions";

export type TeamView = Team & { members: { memberId: string; avatar: string | null; name: string; you: boolean }[] };
/** A member a manager may add to a team. */
export type Candidate = { memberId: string; label: string };

/** Example teams (from the first Teams page, #72), offered as ideas while there are none. */
const EXAMPLE_TEAMS = ["UX Design", "Community", "App Pipeline", "Blockchain", "Privacy", "Security", "Infrastructure"];

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";

/** Run a server action, turning a lost connection into a plain failure. */
async function attempt(action: () => Promise<TeamSaveResult>): Promise<TeamSaveResult> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

const symbolOf = (avatar: string | null) => AVATARS.find((a) => a.id === avatar)?.symbol ?? "👤";

export default function TeamManager({
  teams,
  manage,
  candidates,
  candidatesError,
}: {
  teams: TeamView[];
  manage: boolean;
  candidates: Candidate[] | null;
  candidatesError: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const columns = 4 + (manage ? 1 : 0);

  return (
    <div className="panel">
      <div className="title-row">
        <h2>Teams</h2>
        {manage && !creating && (
          <button type="button" onClick={() => { setCreating(true); setNotice(null); }}>Create team</button>
        )}
      </div>
      {notice && <p className="note" role="status">{notice}</p>}
      {manage && creating && (
        <TeamForm
          heading="Create a team"
          initial={{ name: "", slug: "", description: "" }}
          submitLabel="Save team"
          save={(input) => createTeamAction(input)}
          onDone={(saved) => { setCreating(false); if (saved) setNotice("Team saved."); }}
        />
      )}

      {teams.length === 0 ? (
        <p className="note" role="status">
          No teams yet.{" "}
          {manage ? "Click Create team to make the first one." : "An admin or an editor can make the first one."}{" "}
          Some example teams: {EXAMPLE_TEAMS.join(", ")}.
        </p>
      ) : (
        <table className="game teams">
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Slug</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">Members</th>
              {manage && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <Fragment key={t.id}>
                {editing === t.id ? (
                  <tr>
                    <td colSpan={columns}>
                      <TeamForm
                        heading={`Edit ${t.name}`}
                        initial={{ name: t.name, slug: t.slug, description: t.description ?? "" }}
                        submitLabel="Save changes"
                        save={(input) => updateTeamAction(t.id, input)}
                        onDone={(saved) => { setEditing(null); if (saved) setNotice(`${t.name}: changes saved.`); }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-expanded={open === t.id}
                        onClick={() => setOpen(open === t.id ? null : t.id)}
                      >
                        {t.name}
                      </button>
                    </td>
                    <td><code>{t.slug}</code></td>
                    <td className="note">{t.description ?? "—"}</td>
                    <td className="num">{t.members.length}</td>
                    {manage && (
                      <td>
                        <RowActions
                          team={t}
                          onEdit={() => { setEditing(t.id); setNotice(null); }}
                          onDeleted={() => setNotice(`${t.name} deleted.`)}
                        />
                      </td>
                    )}
                  </tr>
                )}
                {open === t.id && editing !== t.id && (
                  <tr>
                    <td colSpan={columns}>
                      <TeamMembers team={t} manage={manage} candidates={candidates} candidatesError={candidatesError} />
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

/** The fields of a team. A refused save keeps what was typed and says why. */
function TeamForm({
  heading,
  initial,
  submitLabel,
  save,
  onDone,
}: {
  heading: string;
  initial: { name: string; slug: string; description: string };
  submitLabel: string;
  save: (input: TeamInput) => Promise<TeamSaveResult>;
  onDone: (saved: boolean) => void;
}) {
  const [fields, setFields] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => save({ name: fields.name, slug: fields.slug, description: fields.description }));
      if (result.ok) onDone(true);
      else setError(`Not saved. ${result.error}`);
    });
  }

  return (
    <form className="stack team-form" onSubmit={submit} aria-label={heading}>
      <h3>{heading}</h3>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} required maxLength={TEAM_NAME_MAX} value={fields.name}
        onChange={(e) => setFields({ ...fields, name: e.target.value })} />
      <label htmlFor={`${id}-slug`}>Slug</label>
      <input id={`${id}-slug`} maxLength={TEAM_SLUG_MAX} value={fields.slug} placeholder="made from the name if left blank"
        onChange={(e) => setFields({ ...fields, slug: e.target.value })} />
      <span className="note">Lowercase letters, digits and hyphens, for example <code>design-team</code>.</span>
      <label htmlFor={`${id}-description`}>Description</label>
      <textarea id={`${id}-description`} maxLength={TEAM_DESCRIPTION_MAX} rows={3} value={fields.description}
        onChange={(e) => setFields({ ...fields, description: e.target.value })} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="line">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>{" "}
        <button type="button" className="link" disabled={pending} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** Edit and Delete for one team. Delete asks once more before it goes. */
function RowActions({ team, onEdit, onDeleted }: { team: TeamView; onEdit: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await attempt(() => deleteTeamAction(team.id));
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
          <span className="note block">Delete {team.name}? Its members keep their accounts.</span>
          <button type="button" className="link" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Yes, delete"}</button>{" "}
          <button type="button" className="link" disabled={pending} onClick={() => setConfirming(false)}>Keep it</button>
        </>
      ) : (
        <>
          <button type="button" className="link" onClick={onEdit}>Edit</button>{" "}
          <button type="button" className="link" onClick={() => { setConfirming(true); setError(null); }}>Delete</button>
        </>
      )}
      {error && <span className="error block" role="alert">{error}</span>}
    </>
  );
}

/** A team's members, each as their profile allows; a manager adds and removes them. */
function TeamMembers({
  team,
  manage,
  candidates,
  candidatesError,
}: {
  team: TeamView;
  manage: boolean;
  candidates: Candidate[] | null;
  candidatesError: string | null;
}) {
  const [picked, setPicked] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const onTeam = new Set(team.members.map((m) => m.memberId));
  const addable = (candidates ?? []).filter((c) => !onTeam.has(c.memberId));

  function change(action: () => Promise<TeamSaveResult>, done: string, failed: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await attempt(action);
      if (result.ok) {
        setPicked("");
        setMessage({ ok: true, text: done });
      } else setMessage({ ok: false, text: `${failed} ${result.error}` });
    });
  }

  return (
    <div className="team-members">
      <h3>Members of {team.name}</h3>
      <p className="note">Members show only what their profile lets others see: their avatar, and their name if their profile is public.</p>
      {team.members.length === 0 ? (
        <p className="note" role="status">
          Nobody is on this team yet.{manage ? " Add a member below." : ""}
        </p>
      ) : (
        <ul className="team-member-list">
          {team.members.map((m) => (
            <li key={m.memberId}>
              <span aria-hidden="true">{symbolOf(m.avatar)}</span> {m.name}
              {m.you && <span className="note"> (you)</span>}
              {manage && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="link"
                    disabled={pending}
                    aria-label={`Remove ${m.you ? "you" : m.name} from ${team.name}`}
                    onClick={() => change(() => removeTeamMemberAction(team.id, m.memberId), "Member removed.", "Not removed.")}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage &&
        (candidatesError !== null ? (
          <p className="error" role="alert">The member list could not be loaded, so no one can be added right now: {candidatesError}</p>
        ) : addable.length === 0 ? (
          <p className="note">Every member is already on this team.</p>
        ) : (
          <form
            className="filters"
            aria-label={`Add a member to ${team.name}`}
            onSubmit={(e) => {
              e.preventDefault();
              change(() => addTeamMemberAction(team.id, picked), "Member added.", "Not added.");
            }}
          >
            <select aria-label={`Member to add to ${team.name}`} value={picked} onChange={(e) => setPicked(e.target.value)} disabled={pending}>
              <option value="">Pick a member…</option>
              {addable.map((c) => (
                <option key={c.memberId} value={c.memberId}>{c.label}</option>
              ))}
            </select>
            <button type="submit" disabled={pending || !picked}>{pending ? "Saving…" : "Add to team"}</button>
          </form>
        ))}
      {message && <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}
