"use client";

/**
 * "AI task ratings": the Admin page's button that asks the AI to rate the
 * open tasks that need it (core/aiTaskRater.ts `rateTasks`). It says how many
 * it rated, each with its AI score and whether the two models disagreed, and
 * lists every task it could not rate with the reason; a task it could not
 * rate has nothing saved (engineering rule 6). When nothing needed rating it
 * says why (rule 7).
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import type { RatingRunResult } from "../../core/aiTaskRater.ts";
import { TASK_FACTOR_TESTS } from "../../core/taskFactors.ts";
import { rateTasksAction } from "./actions";

const UNREACHABLE =
  "Could not reach WaveCenter, so WaveCenter cannot tell whether any rating saved. Reload the page and click the button again: tasks already rated are skipped.";

const NEED: Record<string, string> = { unrated: "first rating", changed: "task changed", "new-instructions": "new instructions" };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summary(r: RatingRunResult): string {
  const parts = [`Rated ${plural(r.rated.length, "task")}.`];
  if (r.failed.length) parts.push(`${plural(r.failed.length, "task")} could not be rated; nothing was saved for ${r.failed.length === 1 ? "it" : "them"}.`);
  if (r.remaining) parts.push(`${plural(r.remaining, "more task")} still ${r.remaining === 1 ? "needs" : "need"} rating: click again to rate the next ones.`);
  if (!r.rated.length && !r.failed.length && !r.remaining) {
    parts.splice(0, 1, `Nothing needed rating: ${plural(r.upToDate, "open task")} already ${r.upToDate === 1 ? "has" : "have"} an up-to-date rating${r.done ? `, and ${plural(r.done, "done task")} ${r.done === 1 ? "is" : "are"} never rated because ${r.done === 1 ? "its" : "their"} points are locked` : ""}.`);
  }
  return parts.join(" ");
}

export default function RateTasks({ missing }: { missing: string[] }) {
  const [result, setResult] = useState<RatingRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await rateTasksAction();
        if (r.ok) setResult(r.value);
        else setError(r.error);
      } catch {
        setError(UNREACHABLE);
      }
    });
  }

  return (
    <>
      {missing.length > 0 && (
        <p className="error" role="alert">
          This copy of WaveCenter is missing {missing.join(" and ")}, so the AI cannot rate tasks here yet.
        </p>
      )}
      <p>
        <button type="button" onClick={run} disabled={pending || missing.length > 0}>Rate tasks with AI</button>
        {pending && <span className="note"> Asking the AI… this can take a minute.</span>}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <>
          <p className={result.failed.length ? "error" : "note"} role={result.failed.length ? "alert" : "status"}>{summary(result)}</p>
          {result.rated.length > 0 && (
            <div className="rule-table-wrap">
              <table className="game">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Why now</th>
                    <th scope="col" className="num">AI score</th>
                    <th scope="col">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rated.map((t) => (
                    <tr key={t.taskId}>
                      <td><Link href={`/tasks/${t.taskId}`}>{t.title}</Link></td>
                      <td>{NEED[t.need]}</td>
                      <td className="num">{t.aiScore}</td>
                      <td>
                        {t.disagreeOn.length ? (
                          <b>The AI models disagree on {t.disagreeOn.map((k) => TASK_FACTOR_TESTS[k].name.toLowerCase()).join(" and ")}</b>
                        ) : (
                          "Agree"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.failed.length > 0 && (
            <>
              <h3>Not rated</h3>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.taskId}>
                    <Link href={`/tasks/${f.taskId}`}>{f.title}</Link>: {f.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
