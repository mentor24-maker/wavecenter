/**
 * "How the formula works": the Recalculate action points panel's plain
 * explanation of the four factors and a few worked examples. Every name,
 * range, level test and sum comes from core/game.ts, so the explanation
 * cannot drift from what `granularPoints` actually does.
 */
import { FACTOR_KEYS, FACTOR_MAX, FACTOR_TESTS, FORMULA_EXAMPLES, granularWorking } from "../../core/game.ts";

export default function FormulaExplained() {
  return (
    <details className="formula-explained">
      <summary>How the formula works</summary>
      <p>
        <b>Points = 1 + E + 2 × V + R</b>. Each action is scored on four factors, and the formula turns three of them
        into its points. The starting 1 is there because every recorded action counts for something, so the lowest
        any action can score is 1.
      </p>
      <dl>
        {FACTOR_KEYS.map((k) => {
          const t = FACTOR_TESTS[k];
          return (
            <div key={k}>
              <dt>{t.name} ({t.letter}), 0 to {FACTOR_MAX[k]}</dt>
              <dd>
                <p>{t.measures} <b>{t.effect}</b></p>
                <ol>
                  {t.levels.map((level, i) => <li key={i}><b>{i}</b>: {level}</li>)}
                </ol>
              </dd>
            </div>
          );
        })}
      </dl>
      <p>
        Farm risk is still scored for every action, because later anti-farming work will use it, but it does not
        change the points.
      </p>
      <h3>Examples</h3>
      <ul>
        {FORMULA_EXAMPLES.map((e) => (
          <li key={e.action}>
            <b>{e.action}</b> (E {e.factors.effort}, V {e.factors.value}, R {e.factors.rarity}, F {e.factors.farmRisk}):{" "}
            {granularWorking(e.factors)}. {e.why}
          </li>
        ))}
      </ul>
    </details>
  );
}
