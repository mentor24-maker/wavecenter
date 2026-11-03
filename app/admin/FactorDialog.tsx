"use client";

/**
 * The pop-up behind one factor number on "Recalculate action points": the
 * factor and its score, the plain test for that level, and why this action
 * was given it. It only reads. Escape, Close and the backdrop shut it. A
 * score with no reason written says so, never a blank box (engineering
 * rule 7). Looks like the Game Manager's text pop-up (TextDialog).
 */
import { useEffect, useRef, type MouseEvent } from "react";
import { FACTOR_TESTS, type FactorKey } from "../../core/game.ts";

/** Mirrors granularPoints in core/game.ts: farm risk is stored, not counted. */
export const FARM_RISK_NOTE = "Farm risk is scored but not counted in the formula yet; it is kept for anti-farming work to come.";
export const NO_REASON = "No reason has been written for this score yet.";

export default function FactorDialog({
  action,
  factor,
  score,
  reason,
  onClose,
}: {
  action: string;
  factor: FactorKey;
  score: number;
  reason: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const test = FACTOR_TESTS[factor];
  const title = `${test.name}: ${score}`;

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  // A click on the backdrop lands on the dialog itself, outside its box.
  function onClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialog.current) dialog.current?.close();
  }

  return (
    <dialog ref={dialog} className="text-dialog factor-dialog" aria-label={`${action}, ${title}`} onClose={onClose} onClick={onClick}>
      <h2>{title}</h2>
      <p className="note">{action}</p>
      <h3>What {test.name.toLowerCase()} {score} means</h3>
      <p>{test.levels[score] ?? `${score} is not a level ${test.name.toLowerCase()} has.`}</p>
      <h3>Why this action got {score}</h3>
      {reason ? <p>{reason}</p> : <p className="note">{NO_REASON}</p>}
      {factor === "farmRisk" && <p className="note">{FARM_RISK_NOTE}</p>}
      <div className="buttons">
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
