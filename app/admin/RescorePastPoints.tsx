"use client";

/**
 * "Rescore past points": the Admin page's tool for bringing points already
 * earned up (or down) to what each action is worth today, while scoring is
 * provisional (core/game.ts `previewRescore`, `applyRescore`). Preview saves
 * nothing: it lists each action anyone has done, with what it has credited
 * and what it would credit at today's value, and each member's total now
 * and after. Every action that would change is ticked; "Rescore these" adds
 * correction rows for the ticked ones and says how many points changed, or
 * that nothing did and why (engineering rule 6). Once points are final the
 * section says so and both buttons are off.
 */
import { useState, useTransition } from "react";
import { totalAfterRescore, type RescorePreview, type RescoreResult } from "../../core/game.ts";
import { previewRescoreAction, rescoreAction } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter. Check your connection and try again.";

type Message = { ok: boolean; text: string } | null;

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function rescored(result: RescoreResult): Message {
  if (!result.rows) {
    return { ok: true, text: "Nothing changed: every ticked action is already credited at today's value." };
  }
  const rows = `${result.rows} correction${result.rows === 1 ? "" : "s"}`;
  return { ok: true, text: `Rescored. ${rows} added, ${signed(result.points)} points in all. No earlier entry was changed.` };
}

export default function RescorePastPoints({ provisional, me }: { provisional: boolean | null; me: string }) {
  const [preview, setPreview] = useState<RescorePreview | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const isFinal = preview ? !preview.provisional : provisional === false;
  const changing = preview?.actions.filter((a) => a.difference !== 0) ?? [];
  const chosen = ticked.filter((k) => changing.some((a) => a.kind === k));

  function show(next: RescorePreview) {
    setPreview(next);
    setTicked(next.actions.filter((a) => a.difference !== 0).map((a) => a.kind));
  }

  function load() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await previewRescoreAction();
        if (result.ok) show(result.value);
        else setMessage({ ok: false, text: result.error });
      } catch {
        setMessage({ ok: false, text: `${UNREACHABLE} Nothing was worked out.` });
      }
    });
  }

  function rescore() {
    if (!chosen.length) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await rescoreAction(chosen);
        if (!result.ok) {
          setMessage({ ok: false, text: result.error });
          return;
        }
        setMessage(rescored(result.value));
        const again = await previewRescoreAction();
        if (again.ok) show(again.value);
      } catch {
        setMessage({ ok: false, text: `${UNREACHABLE} No points changed.` });
      }
    });
  }

  function toggle(kind: string, on: boolean) {
    setTicked((now) => (on ? [...now, kind] : now.filter((k) => k !== kind)));
  }

  return (
    <>
      {isFinal && (
        <p className="note" role="status">
          Points are final for this DEO, so past points can no longer be rescored. What members have earned stays as it is.
        </p>
      )}
      {provisional === null && !preview && (
        <p className="error" role="alert">WaveCenter could not tell whether points are still provisional. Click Preview to try again.</p>
      )}
      <p>
        <button type="button" onClick={load} disabled={pending || isFinal}>Preview</button>
        {pending && <span className="note"> Working…</span>}
      </p>
      {message && <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {preview && !isFinal && !preview.actions.length && (
        <p className="note">Nobody has earned any points yet, so there is nothing to rescore.</p>
      )}
      {preview && !isFinal && preview.actions.length > 0 && (
        <>
          <p className="note">
            {changing.length
              ? `${changing.length} of ${preview.actions.length} actions would change. Nothing is saved until you click “Rescore these”.`
              : "Every action is already credited at today's value. There is nothing to rescore."}
          </p>
          <div className="rule-table-wrap">
            <table className="game">
              <thead>
                <tr>
                  <th scope="col">Rescore</th>
                  <th scope="col">Action</th>
                  <th scope="col" className="num">Times done</th>
                  <th scope="col" className="num">Credited now</th>
                  <th scope="col" className="num">Would be credited</th>
                  <th scope="col" className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {preview.actions.map((a) => (
                  <tr key={a.kind} className={a.difference ? "recalc-changes" : undefined}>
                    <td>
                      {a.difference ? (
                        <input
                          type="checkbox"
                          aria-label={`Rescore ${a.name}`}
                          checked={ticked.includes(a.kind)}
                          onChange={(e) => toggle(a.kind, e.target.checked)}
                        />
                      ) : (
                        <span className="note">No change</span>
                      )}
                    </td>
                    <td>{a.name}</td>
                    <td className="num">{a.timesDone}</td>
                    <td className="num">{a.creditedNow}</td>
                    <td className="num">{a.wouldBe}</td>
                    <td className="num">{a.difference ? <b>{signed(a.difference)}</b> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Each member</h3>
          <p className="note">Total after counts only the ticked actions.</p>
          <div className="rule-table-wrap">
            <table className="game">
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col" className="num">Total now</th>
                  <th scope="col" className="num">Total after</th>
                </tr>
              </thead>
              <tbody>
                {preview.members.map((m) => {
                  const after = totalAfterRescore(m, chosen);
                  return (
                    <tr key={m.memberId}>
                      <td>
                        {m.memberId === me ? <b>You{m.memberName ? ` (${m.memberName})` : ""}</b> : m.memberName ?? (
                          <span className="note">A member without a public name ({m.memberId.slice(0, 8)})</span>
                        )}
                      </td>
                      <td className="num">{m.now}</td>
                      <td className="num">{after === m.now ? after : <b>{after}</b>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            <button type="button" onClick={rescore} disabled={pending || !chosen.length}>Rescore these</button>
          </p>
        </>
      )}
    </>
  );
}
