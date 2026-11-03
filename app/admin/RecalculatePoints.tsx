"use client";

/**
 * "Recalculate action points": the Admin page's batch job. The first button
 * works out every action's points by formula and shows them beside today's
 * values; it saves nothing. "Put these live" saves only the rows that would
 * change, and says how many did and which did not, with the reason
 * (engineering rule 6). An action with no factor scores yet reads "not
 * scored yet" and is left alone. Each factor number is a button that opens
 * a pop-up saying why the action got that score (FactorDialog).
 */
import { useState, useTransition } from "react";
import { FACTOR_KEYS, FACTOR_TESTS, type FactorKey, type GranularApplyResult, type GranularProposal } from "../../core/game.ts";
import { putActionPointsLive, recalculateActionPoints } from "./actions";
import FactorDialog from "./FactorDialog";

const UNREACHABLE = "Could not reach WaveCenter. Check your connection and try again.";

type Message = { ok: boolean; text: string } | null;

function applied(result: GranularApplyResult): Message {
  const saved = result.saved.length;
  const head = saved ? `${saved} action${saved === 1 ? "'s" : "s'"} points changed.` : "No action's points changed.";
  if (!result.failed.length) return { ok: true, text: `${head} They count from the next time someone does them; points already earned keep their value.` };
  const failed = result.failed.map((f) => `"${f.name}" did not save: ${f.reason}`).join(" ");
  return { ok: false, text: `${head} ${failed}` };
}

export default function RecalculatePoints() {
  const [rows, setRows] = useState<GranularProposal[] | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<{ row: GranularProposal; factor: FactorKey } | null>(null);
  const changing = rows?.filter((r) => r.changes) ?? [];

  function recalculate() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await recalculateActionPoints();
        if (result.ok) setRows(result.value);
        else setMessage({ ok: false, text: result.error });
      } catch {
        setMessage({ ok: false, text: `${UNREACHABLE} Nothing was recalculated.` });
      }
    });
  }

  function putLive() {
    if (!changing.length) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await putActionPointsLive(changing.map((r) => ({ kind: r.kind, now: r.now, proposed: r.proposed as number })));
        if (!result.ok) {
          setMessage({ ok: false, text: result.error });
          return;
        }
        setMessage(applied(result.value));
        const again = await recalculateActionPoints();
        if (again.ok) setRows(again.value);
      } catch {
        setMessage({ ok: false, text: `${UNREACHABLE} Nothing was saved.` });
      }
    });
  }

  return (
    <>
      <p>
        <button type="button" onClick={recalculate} disabled={pending}>Recalculate action points</button>
        {pending && <span className="note"> Working…</span>}
      </p>
      {message && <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      {rows && !rows.length && (
        <p className="error" role="alert">There are no actions in the scoring rules, so there is nothing to recalculate. The game-layer migration has not been applied.</p>
      )}
      {rows && rows.length > 0 && (
        <>
          <p className="note">
            {changing.length
              ? `${changing.length} of ${rows.length} actions would change. Nothing is saved until you click “Put these live”.`
              : `All ${rows.length} actions already match the formula, or are not scored yet. There is nothing to put live.`}
          </p>
          {/* Mirrors granularPoints in core/game.ts; change the two together. */}
          <p className="note">
            Proposed = 1 + E + 2 × V + R, so every action scores at least 1. F (farm risk) is scored but does not change the points. The Now column is today&apos;s value and is not part of the formula.
          </p>
          <p className="note">Click any E, V, R or F number to see why the action got that score.</p>
          <div className="rule-table-wrap">
            <table className="game recalc-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  {FACTOR_KEYS.map((k) => <th key={k} scope="col" className="num" title={FACTOR_TESTS[k].name}>{FACTOR_TESTS[k].letter}</th>)}
                  <th scope="col" className="num">Now</th>
                  <th scope="col" className="num">Proposed</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.kind} className={r.changes ? "recalc-changes" : undefined}>
                    <td>{r.name}</td>
                    {FACTOR_KEYS.map((k) => (
                      <td key={k} className="num">
                        {r.factors ? (
                          <button
                            type="button"
                            className="link factor-score"
                            aria-label={`${r.name}: ${FACTOR_TESTS[k].name} ${r.factors[k]}. Why?`}
                            onClick={() => setOpen({ row: r, factor: k })}
                          >
                            {r.factors[k]}
                          </button>
                        ) : "–"}
                      </td>
                    ))}
                    <td className="num">{r.now}</td>
                    <td className="num">{r.proposed ?? <span className="note">not scored yet</span>}</td>
                    <td>
                      {r.proposed === null ? <span className="note">Left alone</span> : r.changes ? <b>{r.now} → {r.proposed}</b> : <span className="note">No change</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Keyed, and closing clears only its own choice, so a late close
              from the last pop-up never shuts the next one. */}
          {open && open.row.factors && (
            <FactorDialog
              key={`${open.row.kind}:${open.factor}`}
              action={open.row.name}
              factor={open.factor}
              score={open.row.factors[open.factor]}
              reason={open.row.reasons[open.factor]}
              onClose={() => setOpen((now) => (now === open ? null : now))}
            />
          )}
          <p>
            <button type="button" onClick={putLive} disabled={pending || !changing.length}>Put these live</button>
          </p>
        </>
      )}
    </>
  );
}
