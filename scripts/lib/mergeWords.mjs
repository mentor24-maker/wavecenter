/**
 * Dane's written "merge", and the rules that decide what it authorizes.
 *
 * On StarCaster Dane writes `merge` on a `Ready to launch` ticket and a lane
 * on the Mac Mini carries it out. On 2026-10-11 he did the same here, three
 * times, and nothing read it for up to three hours. His decision: "I'd like to
 * be consistent, so let's do that here on WaveCenter."
 *
 * The rules are copied from StarCaster's scripts/builder/mergeOnComment.js
 * (MERGE_PHRASES, whole-message matching, stripping the editor's formatting),
 * without its 1,700 lines of relay machinery. Everything here is pure, so
 * every rule is a test in mergeWords.test.mjs. The `merge-on-comment` command
 * in scripts/clickup.mjs does the reading and writing.
 */

import { isMachineComment } from './machineComment.mjs';
import { newestFirst, readyToLaunchGate, isReviewVerdict, findPullRequest } from './loopTrail.mjs';
import { READY_TO_LAUNCH, NEEDS_YOUR_INPUT } from './loopStatuses.mjs';

/**
 * The exact phrases that mean "merge it". A closed set matched as a WHOLE
 * comment, never as a substring: "do not merge this yet" and "I'll approve
 * the design later" both carry a keyword and must not fire.
 */
export const MERGE_PHRASES = Object.freeze(['merge', 'merge it', 'ship it', 'approve']);

/**
 * Strip what the editor added, never what he said. ClickUp's message box turns
 * a pasted phrase into a fenced block (once as "```cpp\nresume\n```"), and a
 * formatted copy brings **bold** and invisible characters along. On StarCaster
 * that kept a correct instruction unreadable for two days. Only the wrapper
 * goes; the whole remaining message must still equal a phrase.
 */
export function stripEditorFormatting(text) {
  return String(text == null ? '' : text)
    .replace(/^[ \t]*```[^\n`]*\n?/gm, '')
    .replace(/^[ \t]*```[ \t]*$/gm, '')
    .replace(/`/g, '')
    .replace(/[\u200B-\u200F\u2028\u2029\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\*\*|__|~~/g, '')
    .replace(/[*_]/g, '');
}

/** Lowercase, one space between words, trailing "." or "!" dropped ("Merge!" is "merge"). */
export function normalizeCommand(text) {
  return stripEditorFormatting(text).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!\s]+$/g, '');
}

/**
 * A merge phrase may name its pull request: "merge PR #17", "merge #17",
 * "ship it pr 17". On 2026-10-13 Dane wrote "merge PR #17" and the lane read
 * it as "not a merge phrase" for hours. The number is only a pointer; it
 * authorizes nothing unless it is the PR recorded on that very ticket.
 */
const NAMED_PR = /\s+(?:(?:pr|pull request)\s*#?\s*|#)(\d+)$/;

/**
 * Read a comment as a merge command. Returns null when it is not one, else
 * { pr } where pr is the PR number it names, or null when it names none.
 */
export function parseMergeCommand(text) {
  const said = normalizeCommand(text);
  if (MERGE_PHRASES.includes(said)) return { pr: null };
  const m = NAMED_PR.exec(said);
  if (m && MERGE_PHRASES.includes(said.slice(0, m.index))) return { pr: Number(m[1]) };
  return null;
}

/** Is this comment, in its entirety, a merge phrase? (Says nothing about who wrote it.) */
export function isMergePhrase(text) {
  return parseMergeCommand(text) !== null;
}

function dateOf(c) {
  return Number(c && c.date) || 0;
}

/** Dane's own word: his user id, and no machine marker (the loops post under his seat). */
export function isDanesOwnWord(comment, operatorId) {
  if (!comment) return false;
  if (String(comment.user && comment.user.id) !== String(operatorId)) return false;
  return !isMachineComment(comment.comment_text);
}

/**
 * Does this ticket carry Dane's authorization to merge, right now?
 *
 * Returns { ok: true, comment }, or { ok: false, why }. When he DID write a
 * merge phrase but it cannot be honored, the refusal also carries `comment`,
 * `code` and `todo`, so the caller can tell him once.
 *
 * His NEWEST own comment must be a merge phrase. Machine comments are skipped
 * when finding it, so a refusal notice this lane posts does not cancel the
 * authorization (the refusal is re-decided on every pass, the notice posted
 * once). A later plain comment from him ("wait") does cancel it.
 *
 * The authorization must also be newer than the newest PASS verdict: a
 * "merge" written for an earlier review round does not release a rebuilt PR.
 */
export function findAuthorization({ status, comments, operatorId }) {
  const now = String(status ?? '').trim().toLowerCase();
  if (now !== READY_TO_LAUNCH) return { ok: false, why: `status is "${status}", not Ready to launch` };
  const all = newestFirst(comments);
  const his = all.find((c) => isDanesOwnWord(c, operatorId));
  if (!his) return { ok: false, why: 'Dane has not written on this ticket' };
  const command = parseMergeCommand(his.comment_text);
  if (!command) return { ok: false, why: "Dane's newest comment is not a merge phrase" };
  const recorded = findPullRequest(all);
  if (command.pr !== null && (!recorded || recorded.number !== command.pr)) {
    return {
      ok: false, comment: his, code: 'wrong-pr',
      why: `your "merge" names PR #${command.pr}, but this ticket's pull request is ${recorded ? `#${recorded.number}` : 'not recorded'}.`,
      todo: recorded ? `If you meant this ticket's PR, write "merge" (or "merge PR #${recorded.number}").` : 'A session must record the PR with `npm run clickup -- pr-opened`.',
    };
  }
  const gate = readyToLaunchGate(all);
  if (!gate.ok) {
    return { ok: false, comment: his, code: 'no-pass', why: gate.why, todo: 'Only a passed review puts a ticket in Ready to launch. Move it to In review so the review loop checks it again.' };
  }
  const verdict = all.find((c) => isReviewVerdict(c && c.comment_text));
  if (dateOf(his) < dateOf(verdict)) {
    return {
      ok: false, comment: his, code: 'stale-merge',
      why: 'your "merge" is older than the newest review verdict, so it approved an earlier round of this work.',
      todo: 'If you are happy with the reviewed version, write "merge" again.',
    };
  }
  return { ok: true, comment: his };
}

/**
 * Has Dane answered a `Needs your input` ticket? True when his own unstamped
 * comment is the newest one on it and is not a merge phrase (a "merge" there is
 * not an answer to a question; it is in the wrong place).
 */
export function danesAnswer({ status, comments, operatorId }) {
  if (String(status ?? '').trim().toLowerCase() !== NEEDS_YOUR_INPUT) return null;
  const newest = newestFirst(comments)[0];
  if (!isDanesOwnWord(newest, operatorId)) return null;
  if (isMergePhrase(newest.comment_text)) return null;
  return newest;
}

// ── The one refusal notice per authorization and reason ─────────────────────
// A refused authorization is re-decided on every pass, because the reason may
// go away (a check turns green). The notice is posted ONCE: its first line
// names the authorizing comment and the reason code, and a later pass that
// reaches the same refusal finds that line and stays quiet.

const NOTICE_LINE = /^\s*MERGE NOT DONE \(authorization (\S+), reason ([a-z-]+)\)/m;

export function refusalNotice({ authorizationId, code, why, todo }) {
  return [
    `MERGE NOT DONE (authorization ${authorizationId}, reason ${code})`,
    '',
    `Your "merge" was read, but the merge lane did not merge: ${String(why).trim()}`,
    '',
    `What has to happen: ${String(todo).trim()}`,
    '',
    'Your "merge" still stands. Each pass (every 10 minutes) checks again and merges as soon as the reason is gone; this note is not repeated.',
  ].join('\n');
}

/**
 * Was this exact refusal already posted on the ticket? A notice that the build
 * loop has since settled no longer counts: if the same refusal comes back
 * after that, it is news, and the build loop needs a fresh notice to pick the
 * ticket up again. A NOT SETTLED card does not reset it: the conflict is the
 * same one Dane is already being asked about, so neither loop posts again
 * until he answers.
 */
export function alreadyNoticed(comments, authorizationId, code) {
  const answeredAt = dateOf(newestSettleMark(comments, authorizationId, { settledOnly: true }));
  return (comments || []).some((c) => {
    if (!isMachineComment(c && c.comment_text)) return false;
    const m = NOTICE_LINE.exec(String(c.comment_text));
    return Boolean(m && m[1] === String(authorizationId) && m[2] === code && dateOf(c) > answeredAt);
  });
}

// ── The build loop settles a conflict on an approved PR ─────────────────────
// On 2026-10-12 Dane wrote "merge" on a ticket whose PR conflicted with main.
// The lane refused, told him to move the ticket to Rework, and nothing else
// acted on a Ready to launch ticket, so it sat for twelve hours. Now
// loop-build takes such a ticket (after Rework, before Queued), merges main
// into the branch, keeps both sides, and records one of two lines. It never
// changes the status: his "merge" still stands, and this lane carries it out
// once verify is green on the combined code.

/** The refusals the build loop settles. Anything else stays Dane's to read. */
export const SETTLE_CODES = Object.freeze(['conflict', 'catch-up-failed']);

const SETTLE_LINE = /^\s*CONFLICT (SETTLED|NOT SETTLED) \(authorization (\S+), reason ([a-z-]+)\)/m;

/** First line of the build loop's note once main is merged in and pushed. */
export function settledLine({ authorizationId, code }) {
  return `CONFLICT SETTLED (authorization ${authorizationId}, reason ${code})`;
}

/** First line of the card the build loop posts when settling needs his choice. */
export function notSettledLine({ authorizationId, code }) {
  return `CONFLICT NOT SETTLED (authorization ${authorizationId}, reason ${code})`;
}

/**
 * The line a settle-blocked card's @@NEEDED must carry. His plain answer to
 * the card is not a merge phrase, so it replaces his "merge" as his newest
 * word and nothing acts until he writes "merge" again. The card has to tell
 * him so, or the ticket stalls in silence.
 */
export const SETTLE_REPLY_LINE = 'Reply with your choice, then write merge as its own comment.';

/** Why a settle-blocked card's @@NEEDED will not do, or null. */
export function settleCardProblem(needed) {
  const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (flat(needed).includes(flat(SETTLE_REPLY_LINE))) return null;
  return `@@NEEDED must end with this exact line, so Dane knows his answer alone does not merge: "${SETTLE_REPLY_LINE}"`;
}

function newestSettleMark(comments, authorizationId, { settledOnly = false } = {}) {
  return newestFirst(comments).find((c) => {
    if (!isMachineComment(c && c.comment_text)) return false;
    const m = SETTLE_LINE.exec(String(c.comment_text));
    return Boolean(m && m[2] === String(authorizationId) && (!settledOnly || m[1] === 'SETTLED'));
  }) || null;
}

/**
 * Does the build loop owe this ticket a conflict fix? Returns
 * { ok: true, authorizationId, code } or { ok: false, why }.
 *
 * Yes only when: Dane's "merge" stands (findAuthorization), the newest merge
 * lane refusal for THAT authorization is a conflict or a failed catch-up, and
 * the build loop has not already answered that refusal. A "wait" from him
 * cancels the authorization, so the build loop leaves the PR alone.
 */
export function conflictToSettle({ status, comments, operatorId }) {
  const auth = findAuthorization({ status, comments, operatorId });
  if (!auth.ok) return { ok: false, why: auth.why };
  const authorizationId = String(auth.comment.id);
  const notice = newestFirst(comments).find((c) => {
    if (!isMachineComment(c && c.comment_text)) return false;
    const m = NOTICE_LINE.exec(String(c.comment_text));
    return Boolean(m && m[1] === authorizationId);
  });
  if (!notice) return { ok: false, why: 'the merge lane has not refused this "merge"' };
  const code = NOTICE_LINE.exec(String(notice.comment_text))[2];
  if (!SETTLE_CODES.includes(code)) return { ok: false, why: `the merge lane's newest refusal is "${code}", which is not a conflict` };
  const mark = newestSettleMark(comments, authorizationId);
  if (mark && dateOf(mark) > dateOf(notice)) {
    const settled = SETTLE_LINE.exec(String(mark.comment_text))[1] === 'SETTLED';
    return { ok: false, why: settled ? 'the build loop already settled this conflict; the merge lane merges once verify is green' : 'the build loop already asked Dane how to settle this conflict' };
  }
  return { ok: true, authorizationId, code };
}

// ── What GitHub says about the PR, reduced to one decision ─────────────────

/** What a conflict refusal tells Dane. Nothing for him to do: no ticket to move. */
export const SETTLE_TODO = 'Nothing from you. The build loop settles this on its next pass (within about 15 minutes): it merges main into the branch, keeps both sides, and runs verify again. It leaves the ticket in Ready to launch, and this lane merges on your standing word once verify is green. If the two sides need a real choice, the build loop asks you here instead of guessing.';

export const VERIFY_CHECK = 'verify';

/** The `verify` check's state: 'green', 'red', 'pending' or 'missing'. */
export function verifyState(rollup, name = VERIFY_CHECK) {
  const runs = (rollup || []).filter((r) => r && (r.name === name || r.context === name));
  if (!runs.length) return 'missing';
  const states = runs.map((r) => {
    if (r.__typename === 'StatusContext' || r.state) {
      const s = String(r.state || '').toUpperCase();
      return s === 'SUCCESS' ? 'green' : (s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'red');
    }
    if (String(r.status || '').toUpperCase() !== 'COMPLETED') return 'pending';
    return String(r.conclusion || '').toUpperCase() === 'SUCCESS' ? 'green' : 'red';
  });
  if (states.includes('red')) return 'red';
  if (states.includes('pending')) return 'pending';
  return 'green';
}

/**
 * What to do with an authorized PR, given `gh pr view` and how far behind
 * main it is. One of:
 *   { act: 'merge' }
 *   { act: 'already-merged' }
 *   { act: 'update-branch' }     behind main, no conflict: merge main in first
 *   { act: 'wait', why }         GitHub still working; say nothing, try next pass
 *   { act: 'refuse', code, why, todo }
 */
export function prDecision(pr, { behindBy = 0 } = {}) {
  const state = String(pr && pr.state || '').toUpperCase();
  if (state === 'MERGED') return { act: 'already-merged' };
  if (state !== 'OPEN') {
    return { act: 'refuse', code: 'pr-closed', why: `PR #${pr && pr.number} is ${state || 'unreadable'}, not open.`, todo: 'Reopen the PR, or tell a session what should happen to this ticket instead.' };
  }
  const mergeable = String(pr.mergeable || '').toUpperCase();
  if (mergeable === 'CONFLICTING') {
    return { act: 'refuse', code: 'conflict', why: `PR #${pr.number} conflicts with main — the same lines were changed on both sides.`, todo: SETTLE_TODO };
  }
  if (mergeable !== 'MERGEABLE') return { act: 'wait', why: `GitHub has not finished working out whether PR #${pr.number} can merge (${mergeable || 'unknown'})` };
  const checks = verifyState(pr.statusCheckRollup);
  if (checks === 'red') {
    return { act: 'refuse', code: 'verify-red', why: `the \`verify\` check on PR #${pr.number} is failing.`, todo: 'The branch has to be fixed until verify is green. Move the ticket to Rework to have the build loop do it.' };
  }
  if (checks === 'missing') {
    return { act: 'refuse', code: 'verify-missing', why: `PR #${pr.number} has no \`verify\` check at all, so nothing proves it is safe.`, todo: 'Push a new commit to the branch so CI runs, or tell a session to.' };
  }
  if (checks === 'pending') return { act: 'wait', why: `the \`verify\` check on PR #${pr.number} is still running` };
  if (Number(behindBy) > 0) return { act: 'update-branch' };
  return { act: 'merge' };
}

// ── The record of a merge ───────────────────────────────────────────────────
// One first line per merged PR, so a pass that merged but could not set `Live`
// (or a second pass) does not write the same news twice.

export function mergedComment({ prUrl, commit, body }) {
  return `MERGED: ${prUrl} (commit ${commit})\n\n${String(body).trim()}`;
}

export function mergeRecorded(comments, prUrl) {
  const head = `MERGED: ${prUrl} `;
  return (comments || []).some((c) => isMachineComment(c && c.comment_text) && String(c.comment_text).trimStart().startsWith(head));
}
