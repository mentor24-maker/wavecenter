"use client";

/**
 * A topic's place among the others, on its details page (WC-185): a
 * "Parent topic" dropdown to set or clear this topic's parent, and an
 * "Adopt a sub-topic" dropdown to move another topic under this one. The
 * server only offers choices that make no loop and that this member may
 * move; core and the database refuse the rest anyway. A save that fails says
 * why and keeps the choice (engineering rule 6).
 */
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { setTopicParent } from "../../actions";
import { attempt } from "../../forumClient";

type Choice = { id: string; name: string };

function Picker({ label, none, choices, initial, empty, save }: {
  label: string;
  none?: string;
  choices: Choice[];
  initial: string;
  empty: string;
  save: (chosen: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [chosen, setChosen] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const pick = chosen;
    startTransition(async () => {
      const result = await attempt(() => save(pick));
      if (result.ok) {
        setDone(true);
        if (none === undefined) setChosen("");
        router.refresh();
      } else setError(`Not saved. ${result.error}`);
    });
  }

  if (none === undefined && choices.length === 0) {
    return (
      <div className="topic-picker">
        <p className="label"><strong>{label}</strong></p>
        <p className="note">{empty}</p>
      </div>
    );
  }
  const unchanged = none !== undefined ? chosen === initial : chosen === "";
  return (
    <form className="topic-picker" onSubmit={submit} aria-label={label}>
      <label htmlFor={id}><strong>{label}</strong></label>
      <div className="topic-picker-row">
        <select id={id} value={chosen} disabled={pending} onChange={(e) => { setChosen(e.target.value); setDone(false); }}>
          {none !== undefined ? <option value="">{none}</option> : <option value="">Choose a topic…</option>}
          {choices.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button type="submit" disabled={pending || unchanged}>{pending ? "Saving…" : "Save"}</button>
      </div>
      {none !== undefined && choices.length === 0 && <p className="note">{empty}</p>}
      {done && <p className="note" role="status">Saved.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

export default function TopicFamily({ topicId, parentId, mayMoveThis, parents, adoptable }: {
  topicId: string;
  parentId: string;
  /** May this member move this topic itself (its adder, or an admin)? */
  mayMoveThis: boolean;
  parents: Choice[];
  adoptable: Choice[];
}) {
  return (
    <div className="topic-family">
      {mayMoveThis ? (
        <Picker
        label="Parent topic"
        none="None (a top-level topic)"
        choices={parents}
        initial={parentId}
        empty="Every other topic already sits under this one, so only None can be chosen."
        save={(chosen) => setTopicParent(topicId, chosen || null)}
        />
      ) : (
        <p className="note">Only the member who added this topic, or an admin, can set its parent.</p>
      )}
      <Picker
        label="Adopt a sub-topic"
        choices={adoptable}
        initial=""
        empty="No topic can be adopted here: each one is already under this topic, sits above it, or was added by another member (only they or an admin can move it)."
        save={(chosen) => setTopicParent(chosen, topicId)}
      />
    </div>
  );
}
