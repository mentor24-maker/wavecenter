/**
 * The app's side of the AI rating run (core/aiTaskRater.ts): the `TaskRater`
 * that asks one Claude model to rate one task, the store that saves a pass
 * through the database's `record_ai_task_rating`, and the reads the run
 * needs (every task, their attached files' names, each task's newest rating).
 *
 * Server only. Two keys are read here, when a run starts, and never go to
 * the browser (engineering rule 3; `check:browser-secrets` proves it):
 * `ANTHROPIC_API_KEY`, for the AI service, and `SUPABASE_SERVICE_ROLE_KEY`,
 * the only key `record_ai_task_rating` accepts. Neither is ever written to a
 * file or a log. Both calls are ordinary HTTPS calls from WaveCenter's own
 * server code (the Anthropic SDK and Supabase's REST API), so they work on
 * any host (engineering rule 11). Without either key there is no run, and the
 * Admin page says which one is missing.
 *
 * The models answer in a fixed JSON shape (structured outputs,
 * `output_config.format`), and core checks every answer again before saving.
 * There is deliberately no server-side refusal fallback: a fallback would
 * have another model answer under the same pass, and the design wants each
 * named model's own rating. A refusal is a failure, said on screen.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { RATING_ANSWER_SCHEMA, type LatestRating, type TaskRater } from "../../core/aiTaskRater.ts";
import type { Task } from "../../core/tasks.ts";
import type { AiTaskRating, AiTaskRatingStore, NewAiTaskRatingRow } from "../../core/taskFactors.ts";
import { TASK_FACTOR_KEYS } from "../../core/taskFactors.ts";
import type { supabaseForRequest } from "./supabase";
import { fromRow } from "./taskStore";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The settings a run needs that this copy of WaveCenter does not have; empty when it has them all. */
export function missingRatingSettings(): string[] {
  return [
    !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
    !process.env.SUPABASE_URL && "SUPABASE_URL",
    !process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean) as string[];
}

function plainError(model: string, err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error(`The AI service refused WaveCenter's key (asking ${model}).`);
  if (err instanceof Anthropic.RateLimitError) return new Error(`The AI service is busy or WaveCenter has used its limit (asking ${model}). Try again later.`);
  if (err instanceof Anthropic.APIConnectionError) return new Error(`The AI service could not be reached (asking ${model}).`);
  if (err instanceof Anthropic.APIError) {
    // The service's own words (for example "Your credit balance is too low"); they never carry the key.
    const said = (err.error as { error?: { message?: unknown } } | undefined)?.error?.message;
    const reason = typeof said === "string" && said.trim() ? `: ${said.trim().slice(0, 200)}` : ".";
    return new Error(`The AI service refused the request (asking ${model}, HTTP ${err.status ?? "unknown"})${reason}`);
  }
  return new Error(`Asking ${model} failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** The Claude rater, or null when this copy of WaveCenter has no AI key. */
export function claudeTaskRater(): TaskRater | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return {
    async rate(model, instructions, request) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 16000,
          system: instructions,
          messages: [{ role: "user", content: request }],
          output_config: { effort: "medium", format: { type: "json_schema", schema: RATING_ANSWER_SCHEMA } },
        });
      } catch (err) {
        // The SDK's errors never carry the key; log the status only.
        console.error(`ai-rating: ${model} call failed:`, err instanceof Anthropic.APIError ? `HTTP ${err.status} ${JSON.stringify(err.error).slice(0, 300)}` : err);
        throw plainError(model, err);
      }
      if (response.stop_reason === "refusal") throw new Error(`${model} declined to rate this task.`);
      if (response.stop_reason === "max_tokens") throw new Error(`${model}'s answer was cut off before it finished.`);
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text.trim()) throw new Error(`${model} gave no answer.`);
      return text;
    },
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

/**
 * Where a pass is kept. `insert` calls `record_ai_task_rating` with the
 * service key (it accepts no other), which saves the pass whole or not at
 * all and works out the averages and AI score itself; `forTask` reads
 * through the member's own session, as any member may.
 */
export function supabaseAiTaskRatingStore(supabase: Client): AiTaskRatingStore {
  return {
    async insert(row: NewAiTaskRatingRow): Promise<AiTaskRating> {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("This copy of WaveCenter has no service key, so the rating was not saved.");
      const models = row.models.map((m) => ({
        model: m.model,
        ...m.factors,
        ...Object.fromEntries(TASK_FACTOR_KEYS.map((k) => [`${k}_reason`, m.reasons[k]])),
      }));
      let res: Response;
      try {
        res = await fetch(`${url}/rest/v1/rpc/record_ai_task_rating`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            task: row.taskId,
            instruction_version: row.instructionVersion,
            fingerprint: row.fingerprint,
            tool: row.tool,
            models,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        console.error("ai-rating: saving could not reach the database:", err);
        throw new Error("Saving the rating could not reach the database. Nothing was saved.");
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`ai-rating: the database refused a rating: HTTP ${res.status} ${detail.slice(0, 300)}`);
        throw new Error(`The database refused the rating (HTTP ${res.status}). Nothing was saved.`);
      }
      const id: unknown = await res.json();
      if (typeof id !== "string" || !id) throw new Error("The database did not confirm the rating was saved.");
      return { ...row, id, createdAt: new Date().toISOString() };
    },

    async forTask(taskId) {
      const { data, error } = await supabase
        .from("ai_task_ratings")
        .select("*, ai_task_model_ratings(*)")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .order("seq", { ascending: false });
      if (error) failed("read the task's AI ratings", error);
      return (data ?? []).map((r: any) => ({
        id: r.id,
        taskId: r.task_id,
        models: (r.ai_task_model_ratings ?? []).map((m: any) => ({
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

/** What a run reads: every task, each task's own attached files' names, and each task's newest rating. A failed read throws. */
export async function readRatingInputs(supabase: Client): Promise<{
  tasks: Task[];
  fileNames: Map<string, string[]>;
  latest: Map<string, LatestRating>;
}> {
  const [tasks, files, ratings] = await Promise.all([
    supabase.from("tasks").select(),
    supabase.from("task_files").select("task_id, name").is("comment_id", null),
    supabase
      .from("ai_task_ratings")
      .select("task_id, fingerprint, instruction_version")
      .order("created_at", { ascending: false })
      .order("seq", { ascending: false }),
  ]);
  if (tasks.error) failed("read the tasks", tasks.error);
  if (files.error) failed("read the tasks' files", files.error);
  if (ratings.error) failed("read the AI ratings", ratings.error);
  const fileNames = new Map<string, string[]>();
  for (const f of files.data ?? []) fileNames.set(f.task_id, [...(fileNames.get(f.task_id) ?? []), f.name]);
  const latest = new Map<string, LatestRating>();
  for (const r of ratings.data ?? []) {
    if (!latest.has(r.task_id)) latest.set(r.task_id, { fingerprint: r.fingerprint, instructionVersion: r.instruction_version });
  }
  return { tasks: (tasks.data ?? []).map(fromRow), fileNames, latest };
}
