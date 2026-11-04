/**
 * The AI rating lane's `TaskRater` (core/aiTaskRater.ts): one headless
 * Claude Code call (`claude -p`) per model per task, on the Mac Mini, signed
 * in with Dane's monthly Claude plan (Dane, 2026-11-04: "go with the Mini").
 *
 * Task text is written by members, so it is untrusted. The session can only
 * read it and answer:
 *   - every built-in tool is switched off (`--tools ""`), and `--restricted`,
 *     `--safe-mode` and `--strict-mcp-config` drop settings files, hooks,
 *     CLAUDE.md, skills, plugins and MCP servers;
 *   - it starts in a fresh, empty scratch folder, removed afterwards, never
 *     in the repository;
 *   - it gets a bare environment (PATH, HOME, user and locale), so none of
 *     the lane's secrets, the Supabase service key included, reach it;
 *   - the answer must fit the fixed JSON shape (`--json-schema`), and core
 *     checks it again before anything is saved.
 *
 * `ANTHROPIC_API_KEY` must never reach Claude Code: if it sees one, it bills
 * the API account instead of Dane's plan. The lane refuses to start with one
 * set (`refuseApiKey`), and this file never passes one on.
 *
 * @typedef {import('../../core/aiTaskRater.ts').TaskRater} TaskRater
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The only variables the rating session sees. Nothing secret is among them. */
export const PASSED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'];

/** Variables that would make Claude Code bill the API account, or sign in some other way, instead of Dane's plan. */
export const API_BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

/** The flags that take every tool and customisation away from the session. Tests check each is here. */
export const LOCKDOWN_FLAGS = [
  '--tools', '',
  '--restricted',
  '--safe-mode',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--permission-prompts', 'none',
];

/** The bare environment for the session: only PASSED_ENV, whatever the lane's own holds. */
export function ratingEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of PASSED_ENV) if (env[k]) out[k] = env[k];
  return out;
}

/** Throws, in plain words, when the lane's environment would bill the API account. Never prints a value. */
export function refuseApiKey(env = process.env) {
  const found = API_BILLING_ENV.filter((k) => env[k]);
  if (found.length) {
    throw new Error(`${found.join(' and ')} ${found.length === 1 ? 'is' : 'are'} set in the lane's environment, so Claude Code would not use Dane's plan. Nothing was rated. Remove ${found.length === 1 ? 'it' : 'them'} (Doppler wavecenter, or the shell).`);
  }
}

/** The arguments for one rating call. */
export function ratingArgs(model, instructions, schema) {
  return ['-p', '--model', model, '--system-prompt', instructions, ...LOCKDOWN_FLAGS, '--output-format', 'json', '--json-schema', JSON.stringify(schema)];
}

const SIGN_IN_WORDS = /OAuth session expired|Failed to authenticate|Invalid API key|Please run \/login|not logged in/i;

/**
 * Read one call's printed result (`--output-format json`) and return the
 * model's answer as JSON text for core to check. Throws a plain sentence;
 * never the raw output, which could carry member-written text.
 */
export function readClaudeResult(model, stdout, stderr = '', code = 0) {
  // Only Claude Code's own error output is searched for sign-in words, never
  // an answer, which could quote member-written text.
  const signInFailed = () => new Error(`Claude Code on the Mini could not sign in to Claude (asking ${model}). Someone signs in again there with: claude login`);
  if (SIGN_IN_WORDS.test(stderr)) throw signInFailed();
  let r;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    if (SIGN_IN_WORDS.test(stdout)) throw signInFailed();
    throw new Error(`Claude Code gave no readable result (asking ${model}, exit ${code}).`);
  }
  if (r?.is_error || r?.subtype !== 'success') {
    if (SIGN_IN_WORDS.test(String(r?.result ?? ''))) throw signInFailed();
    const status = r?.api_error_status ? `, HTTP ${r.api_error_status}` : '';
    if (/usage limit|rate limit|limit reached/i.test(String(r?.result ?? ''))) throw new Error(`Dane's Claude plan has reached its usage limit for now (asking ${model}). The next pass tries again.`);
    throw new Error(`Claude Code reported a failure (asking ${model}: ${r?.subtype ?? 'unknown'}${status}).`);
  }
  if (r.permission_denials?.length) throw new Error(`${model} tried to use a tool, which the rating session does not allow. Nothing was saved.`);
  const used = Object.keys(r.modelUsage ?? {});
  if (!used.includes(model)) throw new Error(`Claude Code answered with ${used.join(', ') || 'an unnamed model'}, not ${model}. Nothing was saved.`);
  if (r.structured_output != null) return JSON.stringify(r.structured_output);
  if (typeof r.result === 'string' && r.result.trim()) return r.result;
  throw new Error(`${model} gave no answer.`);
}

/** Run one command with the prompt on stdin; resolves { stdout, stderr, code }, or rejects on a time-out. */
function runOnce(bin, args, { cwd, env, input, timeoutMs, spawnFn }) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    child.stdin.end(input);
  });
}

/** At most `n` calls at once, so a pass does not start twenty Claude sessions together. */
function limiter(n) {
  let active = 0;
  /** @type {(() => void)[]} */
  const queue = [];
  return async (fn) => {
    if (active >= n) await new Promise((go) => queue.push(go));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

/**
 * @param {{ claudeBin?: string, schema: Record<string, unknown>, env?: NodeJS.ProcessEnv, timeoutMs?: number, concurrency?: number, spawnFn?: typeof spawn, scratchRoot?: string }} options
 * @returns {TaskRater}
 */
export function claudeCodeRater({ claudeBin = 'claude', schema, env = process.env, timeoutMs = 180_000, concurrency = 2, spawnFn = spawn, scratchRoot = tmpdir() }) {
  refuseApiKey(env);
  const bare = ratingEnv(env);
  const slot = limiter(concurrency);
  return {
    rate: (model, instructions, request) =>
      slot(async () => {
        const cwd = await mkdtemp(join(scratchRoot, 'wavecenter-rating-'));
        try {
          let out;
          try {
            out = await runOnce(claudeBin, ratingArgs(model, instructions, schema), { cwd, env: bare, input: request, timeoutMs, spawnFn });
          } catch (err) {
            throw new Error(`Claude Code could not be run (asking ${model}): ${err instanceof Error ? err.message : String(err)}.`);
          }
          return readClaudeResult(model, out.stdout, out.stderr, out.code);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      }),
  };
}

/**
 * Which Claude sign-in the lane will use, from `claude auth status`, e.g.
 * "claude.ai (max plan)". Throws unless it is a claude.ai sign-in: anything
 * else would bill an API account. The email and organisation are never
 * returned or logged.
 */
export async function claudeSignIn({ claudeBin = 'claude', env = process.env, spawnFn = spawn } = {}) {
  let out;
  try {
    out = await runOnce(claudeBin, ['auth', 'status'], { cwd: tmpdir(), env: ratingEnv(env), input: '', timeoutMs: 30_000, spawnFn });
  } catch (err) {
    throw new Error(`Could not ask Claude Code which sign-in it uses: ${err instanceof Error ? err.message : String(err)}.`);
  }
  let s;
  try {
    s = JSON.parse(out.stdout);
  } catch {
    throw new Error('Claude Code on the Mini did not say which sign-in it uses. Someone signs in there with: claude login');
  }
  if (!s?.loggedIn) throw new Error('Claude Code on the Mini is not signed in. Someone signs in there with: claude login');
  if (s.authMethod !== 'claude.ai') throw new Error(`Claude Code on the Mini is signed in with ${String(s.authMethod).slice(0, 40)}, not a claude.ai plan, so it would not use Dane's plan. Nothing was rated.`);
  const plan = typeof s.subscriptionType === 'string' && /^[a-z0-9_-]{1,20}$/i.test(s.subscriptionType) ? ` (${s.subscriptionType} plan)` : '';
  return `claude.ai${plan}`;
}
