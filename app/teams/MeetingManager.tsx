"use client";

/**
 * The Meeting Manager (WC-204): beside the Team Manager table, a team
 * dropdown over a month calendar. Dates with a meeting for the chosen team
 * are marked; clicking any date opens that date's meetings in a pop-up.
 *
 * Every role that may view teams sees every meeting. A member of the chosen
 * team (Dane, WC-204, "B") also plans, changes and deletes its meetings and
 * invites anyone; the page decides who that is, and the database still
 * refuses a change the viewer may not make.
 *
 * Every save waits for the server's answer. A refused save keeps what was
 * typed and says why; nothing is called saved unless the database took it
 * (engineering rule 6). Dates and times are Mountain time.
 */
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type SyntheticEvent } from "react";
import {
  MEETING_NOTES_MAX, MEETING_TITLE_MAX, MEETING_VENUE_MAX, clockTime, monthGrid, shiftMonth, type Meeting,
} from "../../core/meetings.ts";
import { deleteMeetingAction, saveMeetingAction, type MeetingDeleteResult, type MeetingSaveResult } from "./meetingActions";
import { saveFailureText } from "./meetingView";

/** A team as the Meeting Manager needs it: `mine` when the viewer is on it, so may plan its meetings. */
export type MeetingTeam = { id: string; name: string; mine: boolean };
export type MeetingView = Meeting & { invitees: string[] };
/** A member who may be invited, by the name their profile lets others see. */
export type Invitable = { memberId: string; name: string; label: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";

/** Dates are calendar days already in Mountain time; read them as such, at noon UTC so no zone moves the day. */
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);
const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });

async function attempt<T extends { ok: boolean }>(action: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export default function MeetingManager({
  teams,
  meetings,
  people,
  peopleError,
  today,
}: {
  teams: MeetingTeam[];
  meetings: MeetingView[];
  people: Invitable[] | null;
  peopleError: string | null;
  today: string;
}) {
  const [teamId, setTeamId] = useState(() => (teams.find((t) => t.mine) ?? teams[0])?.id ?? "");
  const [shown, setShown] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const id = useId();

  if (teams.length === 0) {
    return (
      <div className="panel meeting-manager">
        <h2>Meeting Manager</h2>
        <p className="note" role="status">Make a team first to plan its meetings.</p>
      </div>
    );
  }

  const team = teams.find((t) => t.id === teamId) ?? teams[0];
  const ofTeam = meetings.filter((m) => m.teamId === team.id);
  const countOn = new Map<string, number>();
  for (const m of ofTeam) countOn.set(m.date, (countOn.get(m.date) ?? 0) + 1);
  const weeks = monthGrid(shown.year, shown.month);
  const monthLabel = MONTH.format(atNoon(`${shown.year}-${String(shown.month).padStart(2, "0")}-01`));

  return (
    <div className="panel meeting-manager">
      <h2>Meeting Manager</h2>
      <div className="filters">
        <label htmlFor={`${id}-team`}>Team</label>
        <select id={`${id}-team`} value={team.id} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.mine ? " (your team)" : ""}</option>
          ))}
        </select>
      </div>
      <p className="note">
        {team.mine
          ? `Click a date to plan a meeting for ${team.name}, or to see the ones planned. Times are Mountain time.`
          : `Only members of ${team.name} can plan its meetings. Click a date to see the ones planned. Times are Mountain time.`}
      </p>
      {ofTeam.length === 0 && <p className="note" role="status">{team.name} has no meetings planned yet.</p>}

      <div className="calendar-head">
        <button type="button" className="quiet" aria-label="Previous month" onClick={() => setShown(shiftMonth(shown.year, shown.month, -1))}>‹</button>
        <h3 aria-live="polite">{monthLabel}</h3>
        <button type="button" className="quiet" aria-label="Next month" onClick={() => setShown(shiftMonth(shown.year, shown.month, 1))}>›</button>
      </div>
      <table className="calendar">
        <thead>
          <tr>{WEEKDAYS.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((date, j) => {
                if (!date) return <td key={j} className="outside" />;
                const count = countOn.get(date) ?? 0;
                const label = `${LONG_DAY.format(atNoon(date))}${date === today ? ", today" : ""}${count ? `, ${count} meeting${count === 1 ? "" : "s"}` : ""}`;
                return (
                  <td key={j} className={[date === today ? "today" : "", count ? "has-meeting" : ""].filter(Boolean).join(" ") || undefined}>
                    <button type="button" aria-label={label} onClick={() => setOpenDate(date)}>
                      <span>{Number(date.slice(8))}</span>
                      {count > 0 && <span className="meeting-dot" aria-hidden="true">●{count > 1 ? count : ""}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {openDate && (
        <MeetingDay
          key={`${team.id}-${openDate}`}
          date={openDate}
          team={team}
          meetings={ofTeam.filter((m) => m.date === openDate)}
          people={people}
          peopleError={peopleError}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  );
}

/** The pop-up for one date: its meetings, and, for a member of the team, the form to plan or change one. */
function MeetingDay({
  date,
  team,
  meetings,
  people,
  peopleError,
  onClose,
}: {
  date: string;
  team: MeetingTeam;
  meetings: MeetingView[];
  people: Invitable[] | null;
  peopleError: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // "new", a meeting's id, or null for the list.
  const [editing, setEditing] = useState<string | null>(() => (meetings.length === 0 && team.mine ? "new" : null));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = `${team.name}: ${LONG_DAY.format(atNoon(date))}`;
  const nameOf = new Map((people ?? []).map((p) => [p.memberId, p.name]));

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  // The browser shuts a dialog on Escape by itself. Refuse while a save is
  // under way, so its answer always lands where the member can read it.
  function onCancel(e: SyntheticEvent) {
    if (busy) e.preventDefault();
  }

  const current = editing && editing !== "new" ? meetings.find((m) => m.id === editing) ?? null : null;

  return (
    <dialog ref={dialog} className="text-dialog meeting-dialog" aria-label={heading} onCancel={onCancel} onClose={onClose}>
      <h2>{heading}</h2>
      {notice && <p className="note" role="status">{notice}</p>}

      {editing ? (
        <MeetingForm
          key={editing}
          date={date}
          team={team}
          meeting={current}
          people={people}
          peopleError={peopleError}
          onBusy={setBusy}
          onSaved={(text) => { setEditing(null); setNotice(text); }}
          onCancel={() => { setEditing(null); setNotice(null); }}
        />
      ) : meetings.length === 0 ? (
        <p className="note" role="status">
          No meeting is planned on this date for {team.name}.
          {team.mine ? "" : ` Only members of ${team.name} can plan one.`}
        </p>
      ) : (
        <ul className="meeting-list">
          {meetings.map((m) => (
            <MeetingItem
              key={m.id}
              meeting={m}
              team={team}
              nameOf={nameOf}
              onEdit={() => { setEditing(m.id); setNotice(null); }}
              onDeleted={() => setNotice(`${m.title} deleted.`)}
              onBusy={setBusy}
            />
          ))}
        </ul>
      )}

      <div className="buttons">
        {team.mine && !editing && (
          <button type="button" onClick={() => { setEditing("new"); setNotice(null); }}>
            {meetings.length === 0 ? "Plan a meeting" : "Plan another meeting"}
          </button>
        )}
        <button type="button" className="quiet" disabled={busy} onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}

/** One meeting's details, with Edit and Delete for a member of its team. Delete asks once more. */
function MeetingItem({
  meeting,
  team,
  nameOf,
  onEdit,
  onDeleted,
  onBusy,
}: {
  meeting: MeetingView;
  team: MeetingTeam;
  nameOf: Map<string, string>;
  onEdit: () => void;
  onDeleted: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const invited = meeting.invitees.map((id) => nameOf.get(id) ?? "A member");

  function remove() {
    setError(null);
    onBusy(true);
    startTransition(async () => {
      const result: MeetingDeleteResult = await attempt(() => deleteMeetingAction(meeting.id));
      onBusy(false);
      if (result.ok) onDeleted();
      else {
        setConfirming(false);
        setError(`Not deleted. ${result.error}`);
      }
    });
  }

  return (
    <li>
      <h3>{meeting.title}</h3>
      <dl className="task-facts">
        <dt>Starts</dt>
        <dd>{clockTime(meeting.startTime)} Mountain time</dd>
        <dt>Venue</dt>
        <dd>{meeting.venue ?? <span className="note">Not said yet</span>}</dd>
        {meeting.notes && (
          <>
            <dt>Notes</dt>
            <dd className="task-notes">{meeting.notes}</dd>
          </>
        )}
        <dt>Invited</dt>
        <dd>{invited.length ? invited.join(", ") : <span className="note">Nobody invited yet</span>}</dd>
      </dl>
      {team.mine &&
        (confirming ? (
          <p>
            <span className="note block">Delete {meeting.title}? Its invitations go with it.</span>
            <button type="button" className="link" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Yes, delete"}</button>{" "}
            <button type="button" className="link" disabled={pending} onClick={() => setConfirming(false)}>Keep it</button>
          </p>
        ) : (
          <p>
            <button type="button" className="link" onClick={onEdit}>Edit</button>{" "}
            <button type="button" className="link" onClick={() => { setConfirming(true); setError(null); }}>Delete</button>
          </p>
        ))}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

/** The fields of a meeting and who is invited. A refused save keeps what was typed and says why. */
function MeetingForm({
  date,
  team,
  meeting,
  people,
  peopleError,
  onBusy,
  onSaved,
  onCancel,
}: {
  date: string;
  team: MeetingTeam;
  meeting: MeetingView | null;
  people: Invitable[] | null;
  peopleError: string | null;
  onBusy: (busy: boolean) => void;
  onSaved: (notice: string) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState({
    title: meeting?.title ?? "",
    startTime: meeting?.startTime ?? "",
    venue: meeting?.venue ?? "",
    notes: meeting?.notes ?? "",
  });
  const [invited, setInvited] = useState<Set<string>>(() => new Set(meeting?.invitees ?? []));
  // Set once the meeting exists, so a second Save changes it rather than making another.
  const [savedId, setSavedId] = useState<string | null>(meeting?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    onBusy(true);
    startTransition(async () => {
      const result: MeetingSaveResult | { ok: false; error: string } = await attempt(() =>
        saveMeetingAction(savedId, team.id, { ...fields, date }, [...invited]),
      );
      onBusy(false);
      if (result.ok) onSaved(`${fields.title.trim()}: saved.`);
      else {
        // A new meeting that saved without its invitations now exists: the next Save changes it.
        if ("meetingId" in result && result.meetingId) setSavedId(result.meetingId);
        setError(saveFailureText(result));
      }
    });
  }

  function toggle(memberId: string, on: boolean) {
    const next = new Set(invited);
    if (on) next.add(memberId);
    else next.delete(memberId);
    setInvited(next);
  }

  return (
    <form className="stack meeting-form" onSubmit={submit} aria-label={meeting ? `Edit ${meeting.title}` : "Plan a meeting"}>
      <h3>{meeting ? `Edit ${meeting.title}` : "Plan a meeting"}</h3>
      <label htmlFor={`${id}-title`}>Title</label>
      <input id={`${id}-title`} required maxLength={MEETING_TITLE_MAX} value={fields.title} autoFocus
        onChange={(e) => setFields({ ...fields, title: e.target.value })} />
      <label htmlFor={`${id}-time`}>Start time (Mountain time)</label>
      <input id={`${id}-time`} type="time" required value={fields.startTime}
        onChange={(e) => setFields({ ...fields, startTime: e.target.value })} />
      <label htmlFor={`${id}-venue`}>Venue</label>
      <input id={`${id}-venue`} maxLength={MEETING_VENUE_MAX} value={fields.venue} placeholder="For example Zoom, Google Meet, a link or a room"
        onChange={(e) => setFields({ ...fields, venue: e.target.value })} />
      <label htmlFor={`${id}-notes`}>Notes</label>
      <textarea id={`${id}-notes`} rows={3} maxLength={MEETING_NOTES_MAX} value={fields.notes}
        onChange={(e) => setFields({ ...fields, notes: e.target.value })} />
      <fieldset className="invite-picker">
        <legend>Invite members</legend>
        {peopleError !== null ? (
          <p className="error" role="alert">The member list could not be loaded, so no one can be invited right now: {peopleError}</p>
        ) : !people || people.length === 0 ? (
          <p className="note">There are no members to invite yet.</p>
        ) : (
          <>
            <p className="note">Inviting only records who is asked; no message is sent. {invited.size} invited.</p>
            <ul>
              {people.map((p) => (
                <li key={p.memberId}>
                  <label>
                    <input type="checkbox" checked={invited.has(p.memberId)} disabled={pending}
                      onChange={(e) => toggle(p.memberId, e.target.checked)} />{" "}
                    {p.label}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="line">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save meeting"}</button>{" "}
        <button type="button" className="link" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
