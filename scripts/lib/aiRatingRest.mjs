/**
 * The AI rating lane's reads and writes, over Supabase's REST API with the
 * service key (the lane runs on the Mac Mini; the key never leaves it,
 * engineering rule 3):
 *   - `readRatingInputs`: every task, each task's own attached files' names,
 *     and each task's newest rating pass, for core's `rateTasks`;
 *   - `restAiTaskRatingStore`: saves a pass through `record_ai_task_rating`,
 *     which accepts only the service key, and saves it whole or not at all;
 *   - `savePassReport`: one row in `ai_rating_passes` per pass, which the
 *     Admin page reads.
 * A failed read or write throws; nothing here reports success it did not get
 * (engineering rule 6).
 */
import { TASK_FACTOR_KEYS } from '../../core/taskFactors.ts';
import { fromRow } from './restTaskStore.mjs';

/** @param {{ url: string, key: string, fetch?: typeof fetch }} db */
function rest({ url, key, fetch: fetchFn = fetch }) {
  return async (path, { method = 'GET', body, prefer } = {}) => {
    let res;
    try {
      res = await fetchFn(`${url}/rest/v1/${path}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new Error(`could not reach the database (${method} ${path.split('?')[0]}): ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`the database refused ${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}

/** @param {{ url: string, key: string, fetch?: typeof fetch }} db */
export async function readRatingInputs(db) {
  const call = rest(db);
  const [tasks, files, ratings] = await Promise.all([
    call('tasks?select=*'),
    call('task_files?select=task_id,name&comment_id=is.null'),
    call('ai_task_ratings?select=task_id,fingerprint,instruction_version&order=created_at.desc,seq.desc'),
  ]);
  /** @type {Map<string, string[]>} */
  const fileNames = new Map();
  for (const f of files ?? []) fileNames.set(f.task_id, [...(fileNames.get(f.task_id) ?? []), f.name]);
  /** @type {Map<string, { fingerprint: string, instructionVersion: string }>} */
  const latest = new Map();
  for (const r of ratings ?? []) {
    if (!latest.has(r.task_id)) latest.set(r.task_id, { fingerprint: r.fingerprint, instructionVersion: r.instruction_version });
  }
  return { tasks: (tasks ?? []).map(fromRow), fileNames, latest };
}

/**
 * @param {{ url: string, key: string, fetch?: typeof fetch }} db
 * @returns {import('../../core/taskFactors.ts').AiTaskRatingStore}
 */
export function restAiTaskRatingStore(db) {
  const call = rest(db);
  return {
    async insert(row) {
      const models = row.models.map((m) => ({
        model: m.model,
        ...m.factors,
        ...Object.fromEntries(TASK_FACTOR_KEYS.map((k) => [`${k}_reason`, m.reasons[k]])),
      }));
      let id;
      try {
        id = await call('rpc/record_ai_task_rating', {
          method: 'POST',
          body: { task: row.taskId, instruction_version: row.instructionVersion, fingerprint: row.fingerprint, tool: row.tool, models },
        });
      } catch (err) {
        console.error(`rate-tasks: saving task ${row.taskId}'s rating failed: ${err.message}`);
        throw new Error('The database refused the rating. Nothing was saved.');
      }
      if (typeof id !== 'string' || !id) throw new Error('The database did not confirm the rating was saved.');
      return { ...row, id, createdAt: new Date().toISOString() };
    },
    async forTask(taskId) {
      const rows = await call(`ai_task_ratings?task_id=eq.${encodeURIComponent(taskId)}&select=*,ai_task_model_ratings(*)&order=created_at.desc,seq.desc`);
      return (rows ?? []).map((r) => ({
        id: r.id,
        taskId: r.task_id,
        models: (r.ai_task_model_ratings ?? []).map((m) => ({
          model: m.model,
          factors: { scope: m.scope, difficulty: m.difficulty, relevance: m.relevance, demand: m.demand },
          reasons: { scope: m.scope_reason, difficulty: m.difficulty_reason, relevance: m.relevance_reason, demand: m.demand_reason },
        })),
        factors: { scope: Number(r.scope), difficulty: Number(r.difficulty), relevance: Number(r.relevance), demand: Number(r.demand) },
        aiScore: r.ai_score,
        instructionVersion: r.instruction_version,
        fingerprint: r.fingerprint,
        tool: r.tool,
        createdAt: r.created_at,
      }));
    },
  };
}

/** The row a pass leaves in `ai_rating_passes`, from core's result (or a whole-pass error). */
export function passReportRow({ startedAt, signedInWith, result, error, tool }) {
  return {
    started_at: startedAt,
    signed_in_with: signedInWith ?? null,
    rated: result?.rated.length ?? 0,
    failed: (result?.failed ?? []).map((f) => ({ task_id: f.taskId, title: String(f.title).slice(0, 200), reason: String(f.reason).slice(0, 500) })),
    waiting: result?.remaining ?? 0,
    up_to_date: result?.upToDate ?? 0,
    error: error ? String(error).slice(0, 1000) : null,
    tool,
  };
}

/** Save one pass report. Throws if the database did not take it. */
export async function savePassReport(db, row) {
  const saved = await rest(db)('ai_rating_passes', { method: 'POST', body: row, prefer: 'return=representation' });
  if (!Array.isArray(saved) || !saved[0]?.id) throw new Error('the database did not confirm the pass report was saved');
  return saved[0];
}
