/**
 * A `TaskStore` (core/tasks.ts) over Supabase's REST API, for scripts.
 *
 * Scripts create and change tasks through core's functions, never by writing
 * to the table themselves; this adapter is how core reaches the table. It only
 * translates between core's names and the table's columns. Every value it
 * writes was decided and checked in core.
 *
 * @typedef {import('../../core/tasks.ts').Task} Task
 * @typedef {import('../../core/tasks.ts').TaskStore} TaskStore
 */

const COLUMNS = {
  title: 'title',
  notes: 'notes',
  status: 'status',
  parentTaskId: 'parent_task_id',
  points: 'points',
  position: 'position',
  priority: 'priority',
  agentSelected: 'agent_selected',
  tool: 'tool',
};

/** @param {Record<string, unknown>} fields */
export function toRow(fields) {
  /** @type {Record<string, unknown>} */
  const row = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in COLUMNS)) throw new Error(`restTaskStore: no column for "${key}"`);
    row[COLUMNS[/** @type {keyof typeof COLUMNS} */ (key)]] = value;
  }
  return row;
}

/** @param {any} row @returns {Task} */
export function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    ownerId: row.owner_id,
    status: row.status,
    parentTaskId: row.parent_task_id,
    points: row.points,
    position: row.position,
    priority: row.priority,
    agentSelected: row.agent_selected,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/**
 * @param {{ url: string, apiKey: string, token: string, fetch?: typeof fetch }} options
 *   `token` is the signed-in member's access token, so row-level security
 *   applies exactly as it does in the browser.
 * @returns {TaskStore}
 */
export function restTaskStore({ url, apiKey, token, fetch: fetchFn = fetch }) {
  async function call(path, method, body) {
    const res = await fetchFn(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`tasks ${method} failed: HTTP ${res.status} ${text}`);
    return text ? JSON.parse(text) : [];
  }

  return {
    async insert(row) {
      const [made] = await call('tasks', 'POST', toRow(row));
      if (!made) throw new Error('tasks POST returned no row; the task may not have been saved');
      return fromRow(made);
    },
    async get(id) {
      const [row] = await call(`tasks?id=eq.${encodeURIComponent(id)}&select=*`, 'GET');
      return row ? fromRow(row) : null;
    },
    async update(id, changes, onlyIfPoints) {
      const guard = onlyIfPoints === undefined ? '' : `&points=eq.${onlyIfPoints}`;
      const [row] = await call(`tasks?id=eq.${encodeURIComponent(id)}${guard}`, 'PATCH', toRow(changes));
      return row ? fromRow(row) : null;
    },
    async remove(id) {
      const rows = await call(`tasks?id=eq.${encodeURIComponent(id)}`, 'DELETE');
      return rows.length > 0;
    },
  };
}
