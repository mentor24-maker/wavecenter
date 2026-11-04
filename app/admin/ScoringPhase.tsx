"use client";

/**
 * "Scoring phase": the Admin page's switch that ends the provisional phase
 * for good (core/game.ts `makeScoringFinal`). While provisional it says so,
 * with a "Make points final" button. The button opens a warning that this
 * cannot be undone and that "Rescore past points" will stop working, and
 * asks the admin to type FINAL. Cancel, Escape and the backdrop shut it with
 * nothing changed. Once final, the section says since when and by whom.
 * A failure says why and that nothing changed (engineering rule 6).
 */
import { useRef, useState, useTransition, type MouseEvent } from "react";
import { FINAL_CONFIRMATION, type ScoringPhase as Phase } from "../../core/game.ts";
import { finalWhen, finalWho } from "../lib/scoringPhaseText";
import { makeScoringFinalAction } from "./actions";

export default function ScoringPhase({ phase, phaseError, me }: { phase: Phase | null; phaseError: string | null; me: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!phase) {
    return (
      <p className="error" role="alert">
        WaveCenter could not tell whether points are still provisional{phaseError ? `: ${phaseError}` : "."} Try reloading the page.
      </p>
    );
  }
  if (!phase.provisional) {
    return (
      <p className="note" role="status">
        <b>Points are final</b> since {finalWhen(phase)}, set by {finalWho(phase, me)}. What members have earned stays as it
        is, and past points can no longer be rescored.
      </p>
    );
  }

  function open() {
    setTyped("");
    setError(null);
    dialog.current?.showModal();
  }

  // A click on the backdrop lands on the dialog itself, outside its box.
  function onClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialog.current && !pending) dialog.current?.close();
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await makeScoringFinalAction(typed);
        if (result.ok) dialog.current?.close();
        else setError(result.error);
      } catch {
        // The reply was lost, so it may or may not have saved: say that, not "nothing changed".
        setError("Could not reach WaveCenter, so it cannot tell whether points are final now. Reload the page to see.");
      }
    });
  }

  return (
    <>
      <p className="note" role="status">
        <b>Scoring is provisional:</b> points can still be rescored.
      </p>
      <p>
        <button type="button" onClick={open}>Make points final</button>
      </p>
      <dialog ref={dialog} className="text-dialog factor-dialog" aria-label="Make points final" onClick={onClick}>
        <h2>Make points final?</h2>
        <p>
          <b>This cannot be undone.</b> Once points are final, “Rescore past points” stops working for good: every point a
          member has earned keeps the value it was credited, and nobody can rescore history from the app again.
        </p>
        <p>
          <label>
            Type {FINAL_CONFIRMATION} to confirm{" "}
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending} />
          </label>
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="buttons">
          <button type="button" onClick={confirm} disabled={pending || typed.trim() !== FINAL_CONFIRMATION}>
            Make points final
          </button>
          <button type="button" onClick={() => dialog.current?.close()} disabled={pending}>Cancel</button>
          {pending && <span className="note">Working…</span>}
        </div>
      </dialog>
    </>
  );
}
