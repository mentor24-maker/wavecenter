/**
 * Home's box words kept in memory, for core's tests. The rules about who may
 * change them are core's, so this store does not repeat them. Given an
 * engagement store, a save that changes a box's words is scored for
 * `signedIn`, the member the database would see as signed in, as
 * `home_boxes_score` does: saving the same words again scores nothing, and
 * with nobody signed in (a service-key save) nothing is scored. If the
 * engagement cannot be written, the words are not saved either.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { HomeBox, HomeBoxKey, HomeBoxStore } from './homeBoxes.ts';

export class MemoryHomeBoxStore implements HomeBoxStore {
  readonly rows = new Map<HomeBoxKey, HomeBox>();
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  /** Who the database would see as signed in: the member credited for a change. */
  signedIn: string | null;
  private readonly engagements: EngagementStore | null;

  constructor(engagements: EngagementStore | null = null, signedIn: string | null = null) {
    this.engagements = engagements;
    this.signedIn = signedIn;
  }

  async list() {
    return [...this.rows.values()];
  }

  async save(box: HomeBoxKey, body: string, tool: string) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return null;
    }
    // Scored in the same save, before it lands: no engagement, no change.
    const changed = this.rows.get(box)?.body !== body;
    if (changed && this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'changed_a_home_box', tool });
    }
    const saved: HomeBox = { box, body, tool, updatedAt: new Date().toISOString(), updatedBy: this.signedIn };
    this.rows.set(box, saved);
    return saved;
  }
}
