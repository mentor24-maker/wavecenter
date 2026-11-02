#!/usr/bin/env node
/**
 * Give every Evolution card a WaveCenter task (Dane, 2026-11-01: "I thought
 * all cards had to have a task associated with it"). A one-off, safe to run
 * again:
 *
 *   npm run evolution:tasks -- --dry-run   say what it would do, one line per card; write nothing
 *   npm run evolution:tasks                do it
 *
 * For every card with no task yet, oldest first:
 *   1. a card that came from a WaveCenter task still there (thread_url
 *      /tasks/<id>) is linked to that task, so it never gets a second one;
 *   2. every other card (a chat request, a founding commit) is given a new
 *      task through evolution_backfill_task (20261102140000_evolution_task_link.sql):
 *      done, 0 points, owned by Dane, dated at the change's merge time, its
 *      notes holding his words when the card has them. The task and the
 *      card's link are saved together or not at all, and nothing is scored.
 *
 * Points stay at 0; Dane sets real values later from the task page (a done
 * task's points are locked: reopen, set points, mark done). The new tasks are
 * not ticked for AI agents, so they never reach the Loop Queue.
 *
 * Runs with the service key from Doppler, never in the browser. A card that
 * already has a task is skipped, so a second run does nothing and says so. A
 * failed write stops the run and names the card it failed on (engineering
 * rule 6). Exit 0 = done, 1 = something failed.
 */
import { backfillPlan, planLine, summaryLine, taskFromCard } from './lib/evolutionTasks.mjs';
import { mountain } from './lib/evolution.mjs';

// Dane's member account, the earliest one (20261029120000_member_roles.sql makes it the first admin).
const DANE_ID = '3cb23781-b16b-4fae-93e0-85e51915641c';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

class RunFailed extends Error {}

async function db(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((err) => { throw new RunFailed(`could not reach the database: ${err.cause?.code ?? err.message}`); });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function rows(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const got = await db(`/rest/v1/${table}?select=${select}&order=${table === 'tasks' ? 'id' : 'merged_at'}`, { headers: { Range: `${from}-${from + 999}` } });
    if (got.status >= 300) throw new RunFailed(`could not read ${table}: HTTP ${got.status} ${JSON.stringify(got.json)}`);
    out.push(...got.json);
    if (got.json.length < 1000) return out;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--dry-run');
  if (unknown.length) throw new RunFailed(`unknown option ${unknown.join(' ')}; the only one is --dry-run.`);
  const dryRun = args.includes('--dry-run');
  if (!URL_ || !KEY) throw new RunFailed('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set; run it as `npm run evolution:tasks` so Doppler supplies them.');

  const cards = await rows('evolution_entries', 'commit_sha,merged_at,pr_number,title,ticket_url,thread_url,prompt,task_id');
  const taskIds = (await rows('tasks', 'id')).map((t) => t.id);
  const plan = backfillPlan(cards, taskIds);
  const today = mountain(new Date().toISOString()).slice(0, 10);
  let linked = 0;
  let created = 0;

  for (const { card, taskId } of plan.link) {
    console.log(planLine(card, dryRun ? 'would link  ' : 'link        '));
    if (dryRun) { linked += 1; continue; }
    const got = await db(`/rest/v1/evolution_entries?commit_sha=eq.${card.commit_sha}&task_id=is.null`, {
      method: 'PATCH', body: { task_id: taskId }, headers: { Prefer: 'return=representation' },
    });
    if (got.status >= 300) throw new RunFailed(`could not link the card "${card.title}" (${card.commit_sha.slice(0, 7)}) to its task: HTTP ${got.status} ${JSON.stringify(got.json)}. Nothing after it was written.`);
    if (Array.isArray(got.json) && got.json.length === 1) linked += 1;
    else plan.already += 1;
  }

  for (const card of plan.create) {
    console.log(planLine(card, dryRun ? 'would create' : 'create      '));
    if (dryRun) { created += 1; continue; }
    const task = taskFromCard(card, { today });
    const got = await db('/rest/v1/rpc/evolution_backfill_task', {
      method: 'POST',
      body: { p_commit_sha: card.commit_sha, p_owner: DANE_ID, p_title: task.title, p_notes: task.notes, p_at: task.at },
    });
    const result = Array.isArray(got.json) ? got.json[0] : null;
    if (got.status >= 300 || !result?.card_task) {
      throw new RunFailed(`could not give the card "${card.title}" (${card.commit_sha.slice(0, 7)}) its task: HTTP ${got.status} ${JSON.stringify(got.json)}. Nothing was saved for it, and nothing after it was written.`);
    }
    if (result.made) created += 1;
    else plan.already += 1;
  }

  console.log(summaryLine({ linked, created, already: plan.already }, { dryRun }));
}

main().catch((err) => {
  console.error(`evolution:tasks FAILED — ${err.message}`);
  process.exit(1);
});
