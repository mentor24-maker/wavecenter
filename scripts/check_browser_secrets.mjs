#!/usr/bin/env node
/**
 * Engineering rule 3: secret keys never reach the browser. After `next build`,
 * search every file Next.js ships to the browser (.next/static) for the names
 * of the server-only secrets. A hit means some browser code reads one, and
 * fails the build. Run it after `npm run build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.next/static';
const FORBIDDEN = ['SERVICE_ROLE', 'service_role', 'DATABASE_URL', 'CLICKUP_API_TOKEN'];

if (!existsSync(ROOT)) {
  console.error(`check:browser-secrets: ${ROOT} does not exist — run \`npm run build\` first. That is a failure, not a pass.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const word of FORBIDDEN) if (text.includes(word)) hits.push(`${file}: contains "${word}"`);
}
if (hits.length) {
  console.error(`check:browser-secrets: a server-only secret name appears in browser code:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:browser-secrets: ${files.length} browser file(s) searched; no server-only secret name in any of them.`);
