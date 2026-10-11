#!/usr/bin/env node
/**
 * The core never imports the framework (Dane's condition, 2026-10-11).
 * Fails if any file under core/ imports next, react, react-dom or @vercel/*.
 * A rule that lives only in a README is a rule that quietly expires.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /^(next(\/|$)|react(\/|$)|react-dom(\/|$)|@vercel\/)/;
const IMPORT = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

if (!existsSync('core')) {
  console.error('check:core-boundary: core/ does not exist — that is a failure, not a pass.');
  process.exit(1);
}
const files = walk('core');
let bad = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    if (FORBIDDEN.test(m[1])) {
      bad += 1;
      console.error(`${file}: imports "${m[1]}" — core/ must not depend on the framework.`);
    }
  }
}
console.log(`check:core-boundary: ${files.length} file(s) under core/, ${bad} forbidden import(s).`);
process.exit(bad ? 1 : 0);
