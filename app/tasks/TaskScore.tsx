import { TASK_FACTOR_TESTS } from "../../core/taskFactors.ts";
import type { TaskScore as Score } from "../../core/taskScore.ts";
import { fullDate } from "./listView.ts";
import { aiScoreSum, disagreement, FACTOR_ORDER, finalScoreWorking, plainNumber, type AiRatingView } from "./scoreView.ts";

/**
 * "How this task is scored" on a task's page: each factor with the AI's
 * rating and, one click away, every model's rating and reason; then the AI
 * score, the owner's score, the other members' score when there is one, and
 * the final score with the sum that gives it (Dane's rule, 2026-11-03: the
 * final score is the average of the AI's and the owner's). Display only:
 * every number comes from core (core/taskScore.ts, core/taskFactors.ts).
 *
 * `error` is set when the ratings or votes could not be read; the section
 * then says so instead of showing nothing or zeros (engineering rule 7).
 */
export default function TaskScore({ score, rating, error }: { score: Score | null; rating: AiRatingView | null; error: string | null }) {
  if (error || !score) {
    return (
      <section className="task-score box">
        <h2>How this task is scored</h2>
        <p className="error" role="alert">
          How this task is scored could not be loaded: {error ?? "no answer came back"}. Its points have not changed; try reloading the page.
        </p>
      </section>
    );
  }
  const split = rating ? disagreement(rating) : [];

  return (
    <section className="task-score box">
      <h2>How this task is scored</h2>
      {!rating ? (
        <p className="note">The AI has not rated this task yet.</p>
      ) : (
        <>
          <p className="note">
            The AI rates each factor from 1 to 5. Click a factor to read why.
          </p>
          <ul className="factor-list">
            {FACTOR_ORDER.map((k) => {
              const test = TASK_FACTOR_TESTS[k];
              return (
                <li key={k}>
                  <details>
                    <summary>
                      <span className="factor-name">{test.name}</span> <span className="factor-rating">{plainNumber(rating.factors[k])} of 5</span>
                      {split.includes(k) && <span className="note"> · the AI models disagree</span>}
                    </summary>
                    <p className="note">{test.measures}</p>
                    <ul className="model-reasons">
                      {rating.models.map((m) => (
                        <li key={m.model}>
                          <strong>{m.model}: {m.factors[k]}</strong>. {m.reasons[k]}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <dl className="score-parts">
        <dt>AI score</dt>
        <dd>
          {score.ai === null ? (
            "Not yet"
          ) : (
            <>
              {score.ai}
              {rating && (
                <span className="note">
                  {" "}
                  · {aiScoreSum(rating)} (scope × difficulty × (relevance + demand) ÷ 5).
                  Rated by {rating.models.map((m) => m.model).join(" and ")} on{" "}
                  <time dateTime={rating.createdAt}>{fullDate(rating.createdAt)}</time>.
                </span>
              )}
            </>
          )}
        </dd>
        <dt>Owner&apos;s score</dt>
        <dd>{score.owner === null ? "Not set" : score.owner}</dd>
        {score.others !== null && (
          <>
            <dt>Other members&apos; score</dt>
            <dd>
              {score.others}{" "}
              <span className="note">· the average of {score.othersVotes} vote{score.othersVotes === 1 ? "" : "s"}</span>
            </dd>
          </>
        )}
        <dt>Final score</dt>
        <dd>
          <strong>{score.final}</strong> <span className="note">· {finalScoreWorking(score)}.</span>
          {score.provisional && <span className="note"> Provisional until the AI rates it.</span>}
          {score.locked && score.points !== score.final && (
            <span className="note"> The task is done, so its points stay locked at {score.points}.</span>
          )}
        </dd>
      </dl>
    </section>
  );
}
