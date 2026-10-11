/**
 * The ONE list of secret names WaveCenter expects in Doppler, and the configs
 * each one must be in. A ticket that adds a key adds a line here, so
 * `npm run doctor` starts reporting it the moment the code depends on it.
 * Names only: no value ever appears in this repository (it is public).
 */
export const DOPPLER_PROJECT = 'wavecenter';
export const CONFIGS = ['dev', 'prd'];

export const EXPECTED_SECRETS = [
  { name: 'SUPABASE_URL', configs: ['dev', 'prd'], what: 'the database address (not secret)' },
  { name: 'SUPABASE_ANON_KEY', configs: ['dev', 'prd'], what: 'the public database key' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', configs: ['dev', 'prd'], what: 'the server-only database key' },
  { name: 'DATABASE_URL', configs: ['dev', 'prd'], what: 'the Postgres connection string' },
  { name: 'CLICKUP_API_TOKEN', configs: ['dev'], what: 'the ClickUp token, for scripts only' },
];

/**
 * Compare what Doppler holds against the list. `present` maps a config name
 * to the set of names it holds, or to null when the config could not be read.
 * Returns one row per expected name and whether everything required is there.
 */
export function doctorReport(present, expected = EXPECTED_SECRETS, configs = CONFIGS) {
  const rows = expected.map(({ name, configs: needed }) => ({
    name,
    cells: Object.fromEntries(configs.map((config) => {
      const names = present[config];
      if (!needed.includes(config)) return [config, 'not needed'];
      if (!names) return [config, 'unreadable'];
      return [config, names.has(name) ? 'present' : 'MISSING'];
    })),
  }));
  const ok = rows.every((row) => Object.values(row.cells).every((c) => c === 'present' || c === 'not needed'));
  return { rows, ok };
}

/** The report as a plain-text table, one line per name. */
export function formatReport({ rows }, configs = CONFIGS) {
  const width = Math.max(4, ...rows.map((r) => r.name.length));
  const col = 12;
  const lines = [['NAME'.padEnd(width), ...configs.map((c) => c.padEnd(col))].join('  ').trimEnd()];
  for (const row of rows) {
    lines.push([row.name.padEnd(width), ...configs.map((c) => row.cells[c].padEnd(col))].join('  ').trimEnd());
  }
  return lines.join('\n');
}
