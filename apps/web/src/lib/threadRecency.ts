// ── Thread recency ──────────────────────────────────────────────────
//
// Canonical comparator for sidebar/search thread ordering.
// Primary: updatedAt DESC, Secondary: createdAt DESC, Tertiary: id DESC.

/** Minimal shape needed by the recency comparator. */
export interface ThreadRecencyFields {
  id: string;
  updatedAt: string;
  createdAt: string;
}

/** Compare two threads by recency (most recent first). */
export function compareThreadsByRecency(a: ThreadRecencyFields, b: ThreadRecencyFields): number {
  const byUpdated = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byUpdated !== 0) return byUpdated;
  const byCreated = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (byCreated !== 0) return byCreated;
  return b.id.localeCompare(a.id);
}

/** Return the updatedAt timestamp in ms for a thread. */
export function getThreadRecencyMs(thread: ThreadRecencyFields): number {
  return new Date(thread.updatedAt).getTime();
}
