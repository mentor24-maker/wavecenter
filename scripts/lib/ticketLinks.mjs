/**
 * Ticket links: building one, and reading which ticket a link names. Plain
 * functions, no I/O, shared by the hand-off commands (lib/handoff.mjs) and
 * the Evolution pictures (lib/evolution.mjs), so both read a link the same way.
 */

/**
 * A ticket's link, the one a task records and Dane's screen shows. With
 * `trackerUrl`, the tracker's own page, `<trackerUrl>/t/WC-12`: every ticket
 * since the move to the tracker (SP-23). The caller passes the tracker's
 * public https address (the project config's `trackerPublicUrl`), because
 * core records only https links. Without it, the ClickUp link the tasks
 * handed off before the move still carry.
 */
export function ticketUrl(ticketId, trackerUrl = null) {
  if (trackerUrl) return `${String(trackerUrl).replace(/\/+$/, '')}/t/${ticketId}`;
  return `https://app.clickup.com/t/${ticketId}`;
}

/** The ClickUp ticket id in a ticket link, or null. */
export function ticketIdFromUrl(url) {
  const m = /^https:\/\/app\.clickup\.com\/t\/([A-Za-z0-9]+)\/?$/.exec(String(url ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Where a recorded ticket link points: `{ where: 'tracker', id }` for a
 * tracker page (`<address>/t/WC-12`, at any of `trackerUrls`: the public
 * address and the local one), `{ where: 'clickup', id }` for a ClickUp link
 * from before the move, or null for anything else.
 * @param {unknown} url
 * @param {string | null | Array<string | null | undefined>} trackerUrls
 */
export function ticketRef(url, trackerUrls = []) {
  const text = String(url ?? '').trim();
  for (const base of [trackerUrls].flat()) {
    if (!base) continue;
    const escaped = String(base).replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^${escaped}/t/([A-Za-z]+-[0-9]+)/?$`).exec(text);
    if (m) return { where: 'tracker', id: m[1].toUpperCase() };
  }
  const id = ticketIdFromUrl(text);
  return id ? { where: 'clickup', id } : null;
}
