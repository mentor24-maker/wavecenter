/**
 * Keep the Mac Mini's test database (WaveCenter's local Supabase in Docker)
 * reachable, even after a worktree is deleted (WC-240).
 *
 * What went wrong on 2026-11-26 (WC-239): `supabase start` had been run inside
 * a worktree, so the Kong container (the test database's front door)
 * bind-mounted `supabase/templates/recovery.html` from that worktree. When
 * the worktree was cleaned up, Kong could not restart ("not a directory"),
 * `supabase start` left it stopped, and `supabase status` stopped reporting
 * the address. Evolution pictures and `npm run db:test` failed for hours.
 *
 * So the stack is always started from the main checkout, and before it is
 * used, `ensureTestDb` looks at it: a container that exists but is not
 * running, a mount whose host path is gone, or a status with no address means
 * one `supabase stop` + `supabase start` from the main checkout, then the
 * status is read again.
 *
 * A container's `com.supabase.cli.workdir` label naming a folder that is gone
 * is NOT a reason: `supabase db reset` (run by db:test from any worktree, and
 * by Evolution capture from a temp folder it deletes) re-creates the db
 * container with that label but no bind mount from it, so the stack is fine.
 * Only a missing bind-mount source breaks anything (WC-240 review).
 *
 * `supabase status` always lists the services config.toml turns off (studio,
 * imgproxy, ...) as "Stopped services"; those have no container, so that list
 * alone is never a reason to restart.
 *
 * Every command goes through `run(cmd, args, { cwd })` -> { status, stdout,
 * stderr }, and every path check through `exists(path)`, so tests fake both.
 */
import { lastJson } from './migrations.mjs';

/** The main checkout's folder, from any worktree of it. */
export function mainCheckout(repo, run) {
  const r = run('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo });
  const dir = String(r.stdout || '').trim();
  if (r.status !== 0 || !dir) return repo;
  return dir.replace(/\/\.git\/?$/, '');
}

/** The project_id in supabase/config.toml's text ("wavecenter" when it has none). */
export function projectId(configText) {
  const m = String(configText || '').match(/^project_id\s*=\s*"([^"]+)"/m);
  return m ? m[1] : 'wavecenter';
}

/** Parse `docker inspect` JSON into the few facts the decision needs. */
export function parseContainers(inspectJson) {
  let list;
  try {
    list = JSON.parse(String(inspectJson || '[]'));
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  return list.map((c) => ({
    name: String(c?.Name || '').replace(/^\//, ''),
    running: Boolean(c?.State?.Running),
    state: String(c?.State?.Status || 'unknown'),
    mounts: (Array.isArray(c?.Mounts) ? c.Mounts : []).filter((m) => m?.Type === 'bind' && m.Source).map((m) => String(m.Source)),
  }));
}

/**
 * Why the stack needs a restart: a list of plain-English reasons, empty when
 * it is healthy. `containers` comes from parseContainers; `reported` is
 * whether `supabase status` gave an address.
 */
export function repairReasons({ reported, containers, exists }) {
  const reasons = [];
  if (!reported) reasons.push('`supabase status` did not report the test database address');
  const stopped = containers.filter((c) => !c.running).map((c) => `${c.name} (${c.state})`);
  if (stopped.length) reasons.push(`stopped: ${stopped.join(', ')}`);
  const missing = [...new Set(containers.flatMap((c) => c.mounts.filter((p) => !exists(p))))];
  if (missing.length) reasons.push(`mounts a path that no longer exists: ${missing.join(', ')}`);
  return reasons;
}

/** Read `supabase status` and the project's containers. */
export function readStack({ run, exists, main, project }) {
  const status = run('supabase', ['status', '-o', 'json'], { cwd: main });
  const s = status.status === 0 ? lastJson(status.stdout, 'API_URL') : null;
  const names = run('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.Names}}'], { cwd: main });
  const list = String(names.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let containers = [];
  if (names.status === 0 && list.length) {
    const inspected = run('docker', ['inspect', ...list], { cwd: main });
    containers = (inspected.status === 0 && parseContainers(inspected.stdout)) || [];
  }
  const reported = Boolean(s && s.API_URL);
  return { status: reported ? s : null, containers, reasons: repairReasons({ reported, containers, exists }) };
}

/**
 * Make sure the test database answers, repairing it once if it needs to.
 * Returns { ok, status, repaired, reasons, message }: `status` is the parsed
 * `supabase status` (API_URL, ANON_KEY, SERVICE_ROLE_KEY) when ok; `message`
 * says what is still wrong when not.
 */
export function ensureTestDb({ run, exists, main, project, log = () => {} }) {
  const first = readStack({ run, exists, main, project });
  if (!first.reasons.length) return { ok: true, status: first.status, repaired: false, reasons: [], message: '' };

  log(`the test database needs a restart (${first.reasons.join('; ')}); restarting it from ${main}...`);
  const stop = run('supabase', ['stop'], { cwd: main });
  const start = stop.status === 0 ? run('supabase', ['start'], { cwd: main }) : null;
  const after = readStack({ run, exists, main, project });
  if (after.status && !after.reasons.length) return { ok: true, status: after.status, repaired: true, reasons: first.reasons, message: '' };

  const steps = stop.status !== 0 ? '`supabase stop` failed' : start.status !== 0 ? '`supabase start` failed' : 'it was restarted';
  const still = after.reasons.length ? after.reasons.join('; ') : 'no reason found';
  // An address with only a disabled extra stopped is still usable; only no address is fatal.
  if (after.status) return { ok: true, status: after.status, repaired: true, reasons: first.reasons, message: `still not fully healthy after the restart: ${still}` };
  return {
    ok: false,
    status: null,
    repaired: true,
    reasons: first.reasons,
    message: `the test database still does not answer: before the restart: ${first.reasons.join('; ')}; ${steps} from ${main}, and now: ${still}. Docker must be running (\`colima status\`).`,
  };
}
