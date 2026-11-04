#!/usr/bin/env node
/**
 * One pass of the AI rating lane:
 *
 *   npm run rate-tasks                # live, on the Mac Mini (Doppler gives only the Supabase secrets)
 *   npm run rate-tasks -- --limit 2   # rate at most 2 tasks this pass
 *
 * The lane (scripts/rating_lane.sh, launchd label com.wavecenter.ai-rating)
 * runs this every 30 minutes. It rates up to 10 open tasks that need a
 * rating (core/aiTaskRater.ts `rateTasks`), each by both models, through
 * Claude Code signed in with Dane's plan (scripts/lib/claudeCodeRater.mjs,
 * every tool off), saves each task's pass whole or not at all, and leaves one
 * report row in `ai_rating_passes` for the Admin page.
 *
 * It refuses to start if ANTHROPIC_API_KEY (or another API sign-in) is in its
 * environment, or if Claude Code is not signed in with a claude.ai plan:
 * either would bill an API account instead of Dane's plan. A refusal is
 * still reported to the Admin page, when the database can be reached.
 *
 * Exit 0 = the pass ran (some tasks may have failed; the report says which).
 * Exit 1 = the whole pass failed (the report, and the log, say why).
 */
import { AI_RATING_TOOL, RATING_ANSWER_SCHEMA, RATING_RUN_MAX_TASKS, rateTasks } from '../core/aiTaskRater.ts';
import { claudeCodeRater, claudeSignIn, refuseApiKey } from './lib/claudeCodeRater.mjs';
import { passReportRow, readRatingInputs, restAiTaskRatingStore, savePassReport } from './lib/aiRatingRest.mjs';

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : RATING_RUN_MAX_TASKS;
if (!Number.isInteger(limit) || limit < 1 || limit > RATING_RUN_MAX_TASKS) {
  console.error(`rate-tasks: --limit must be a whole number from 1 to ${RATING_RUN_MAX_TASKS}.`);
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('rate-tasks: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set; run it as `npm run rate-tasks` so Doppler supplies them.');
  process.exit(1);
}
const db = { url, key };
const claudeBin = process.env.CLAUDE_BIN || 'claude';
const startedAt = new Date().toISOString();

async function report(fields) {
  try {
    await savePassReport(db, passReportRow({ startedAt, tool: AI_RATING_TOOL, ...fields }));
    console.log('rate-tasks: pass report saved for the Admin page.');
    return true;
  } catch (err) {
    console.error(`rate-tasks: the pass report could NOT be saved, so the Admin page will not show this pass: ${err.message}`);
    return false;
  }
}

let signedInWith = null;
try {
  refuseApiKey(process.env);
  signedInWith = await claudeSignIn({ claudeBin });
  console.log(`rate-tasks: Claude sign-in: ${signedInWith}. Database: ${new URL(url).host}. At most ${limit} task(s) this pass.`);

  const inputs = await readRatingInputs(db).catch((err) => {
    throw new Error(`Could not read the tasks, so nothing was rated: ${err.message}`);
  });
  const result = await rateTasks({
    ...inputs,
    store: restAiTaskRatingStore(db),
    rater: claudeCodeRater({ claudeBin, schema: RATING_ANSWER_SCHEMA }),
    tool: AI_RATING_TOOL,
    limit,
  });

  console.log(`rate-tasks: rated ${result.rated.length}, could not rate ${result.failed.length}, still waiting ${result.remaining}, up to date ${result.upToDate}, done (never rated) ${result.done}.`);
  for (const t of result.rated) {
    console.log(`  rated  ${t.taskId}  AI score ${t.aiScore}${t.disagreeOn.length ? `  (models disagree on ${t.disagreeOn.join(', ')})` : ''}  ${t.title}`);
  }
  for (const f of result.failed) console.log(`  FAILED ${f.taskId}  ${f.title}: ${f.reason}`);
  const saved = await report({ signedInWith, result });
  process.exit(saved ? 0 : 1);
} catch (err) {
  const why = err instanceof Error ? err.message : String(err);
  console.error(`rate-tasks: the pass FAILED: ${why}`);
  await report({ signedInWith, error: why });
  process.exit(1);
}
