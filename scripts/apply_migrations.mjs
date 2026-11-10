#!/usr/bin/env node
/**
 * WaveCenter's pre-merge step: apply a pull request's database change to the
 * live database just before the relay merges it, on Dane's written `merge`.
 *
 * Wired in `spirality.project.json` as `preMergeCommand`; Spirality's relay
 * (SP-185) runs it from the main checkout with LOOP_PR_NUMBER, LOOP_PR_URL,
 * LOOP_HEAD_SHA, LOOP_BASE_BRANCH and LOOP_TICKET_ID set, under Doppler, which
 * supplies DATABASE_URL. Exit 0 lets the merge go ahead; any other exit merges
 * nothing. The work is `preMergeStep` in scripts/lib/migrations.mjs.
 *
 * Never run this by hand against the live database to test a migration:
 * test with `npm run db:test` (CLAUDE.md, and Dane's "B it is", 2026-10-29).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preMergeStep } from './lib/migrations.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const { code, lines } = preMergeStep({ repoDir: REPO });
for (const line of lines) (code === 0 ? console.log : console.error)(line);
process.exitCode = code;
