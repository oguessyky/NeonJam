// Round-robin queue engine — decision #9.
//
// Model: play order cycles through *active contributors* (anyone with >=1 pending
// song), one song per turn. Within a contributor's turn their top-voted pending
// song surfaces. Strict rounds: a round = one pass through the contributors that
// were eligible when the round started; a contributor who activates *after* the
// round has begun serving waits for the NEXT round (no cutting).
//
// Fairness note (decision #14): no per-person cap — a contributor with many songs
// simply plays one per round; the extras wait their future turns.

import type { QueueItem } from "./types";

export type RoundRobinState = {
  /** Contributor clientIds in the order they first entered rotation. */
  rotation: string[];
  /** The round index currently being consumed. */
  currentRound: number;
  /** Contributors already served in `currentRound`. */
  servedThisRound: Set<string>;
  /** Contributor clientId -> the round at which they became eligible. */
  joinedRound: Map<string, number>;
  /** All pending songs (flat). Grouped by `addedBy` on demand. */
  pending: QueueItem[];
  /**
   * Host "play next" override lane (decision #23): ordered queue-item ids that
   * jump ahead of the round-robin. A PURE override — draining a pin does NOT
   * touch the round/served bookkeeping, so fairness underneath is undisturbed.
   */
  pinned: string[];
};

export function createRoundRobin(): RoundRobinState {
  return {
    rotation: [],
    currentRound: 0,
    servedThisRound: new Set(),
    joinedRound: new Map(),
    pending: [],
    pinned: [],
  };
}

/** Host bumps an item to play next — front of the pinned lane (decision #23). */
export function pinNext(rr: RoundRobinState, itemId: string): void {
  if (!rr.pending.some((p) => p.id === itemId)) return;
  rr.pinned = [itemId, ...rr.pinned.filter((id) => id !== itemId)];
}

export function unpin(rr: RoundRobinState, itemId: string): void {
  rr.pinned = rr.pinned.filter((id) => id !== itemId);
}

/** Replace the pinned lane order (host drag-reorder). Drops stale ids. */
export function setPinnedOrder(rr: RoundRobinState, order: string[]): void {
  const seen = new Set<string>();
  rr.pinned = order.filter(
    (id) => rr.pending.some((p) => p.id === id) && !seen.has(id) && seen.add(id),
  );
}

function pendingCountFor(rr: RoundRobinState, clientId: string): number {
  let n = 0;
  for (const p of rr.pending) if (p.addedBy === clientId) n++;
  return n;
}

/** Top-voted pending song for a contributor (ties broken by add-order). */
function topSongFor(rr: RoundRobinState, clientId: string): QueueItem | undefined {
  let best: QueueItem | undefined;
  for (const p of rr.pending) {
    if (p.addedBy !== clientId) continue;
    if (
      !best ||
      p.voters.length > best.voters.length ||
      (p.voters.length === best.voters.length && p.addedAt < best.addedAt)
    ) {
      best = p;
    }
  }
  return best;
}

/**
 * Register that a contributor now has >=1 pending song. Call ONLY on the
 * 0 -> >=1 transition. Assigns their eligible round so latecomers wait.
 */
function activateContributor(rr: RoundRobinState, clientId: string): void {
  if (!rr.rotation.includes(clientId)) rr.rotation.push(clientId);
  // Can join the current round only if the round hasn't started serving yet;
  // otherwise wait for the next round (no cutting).
  rr.joinedRound.set(
    clientId,
    rr.servedThisRound.size === 0 ? rr.currentRound : rr.currentRound + 1,
  );
}

/** Add a song to the queue. Handles activation + round assignment. */
export function addSong(rr: RoundRobinState, item: QueueItem): void {
  const before = pendingCountFor(rr, item.addedBy);
  rr.pending.push(item);
  if (before === 0) activateContributor(rr, item.addedBy);
}

/** Remove a specific queue entry (self-removal / host removal). */
export function removeSong(rr: RoundRobinState, itemId: string): QueueItem | undefined {
  const idx = rr.pending.findIndex((p) => p.id === itemId);
  if (idx === -1) return undefined;
  unpin(rr, itemId);
  return rr.pending.splice(idx, 1)[0];
}

/** Remove every pending song from a contributor (kick / host-drop). */
export function removeContributor(rr: RoundRobinState, clientId: string): void {
  const dropped = new Set(rr.pending.filter((p) => p.addedBy === clientId).map((p) => p.id));
  rr.pending = rr.pending.filter((p) => p.addedBy !== clientId);
  rr.pinned = rr.pinned.filter((id) => !dropped.has(id));
  rr.rotation = rr.rotation.filter((c) => c !== clientId);
  rr.joinedRound.delete(clientId);
  rr.servedThisRound.delete(clientId);
}

/** Find a pending entry by videoId (for duplicate detection, decision #11). */
export function findByVideoId(rr: RoundRobinState, videoId: string): QueueItem | undefined {
  return rr.pending.find((p) => p.videoId === videoId);
}

/**
 * Core scan: return the next contributor+song to serve given the current round
 * bookkeeping, advancing the round at most once if the current round is spent.
 * Mutates `rr` (marks served / advances round / removes the song).
 * Returns undefined only when there are no pending songs at all.
 */
export function pickNext(rr: RoundRobinState): QueueItem | undefined {
  // Host "play next" pins jump the line first (decision #23) — a pure override
  // that leaves round/served bookkeeping untouched. Skip stale pins.
  while (rr.pinned.length) {
    const id = rr.pinned.shift()!;
    const idx = rr.pending.findIndex((p) => p.id === id);
    if (idx !== -1) return rr.pending.splice(idx, 1)[0];
  }
  // At most two passes: current round, then (if spent) the next round.
  for (let pass = 0; pass < 2; pass++) {
    for (const cid of rr.rotation) {
      if (rr.servedThisRound.has(cid)) continue;
      if ((rr.joinedRound.get(cid) ?? Infinity) > rr.currentRound) continue;
      const song = topSongFor(rr, cid);
      if (!song) continue;
      rr.servedThisRound.add(cid);
      rr.pending = rr.pending.filter((p) => p.id !== song.id);
      return song;
    }
    // Current round is spent. If nothing pending anywhere, we're empty.
    if (rr.pending.length === 0) return undefined;
    // Advance to the next round and retry.
    rr.currentRound += 1;
    rr.servedThisRound = new Set();
  }
  return undefined;
}

function cloneRR(rr: RoundRobinState): RoundRobinState {
  return {
    rotation: [...rr.rotation],
    currentRound: rr.currentRound,
    servedThisRound: new Set(rr.servedThisRound),
    joinedRound: new Map(rr.joinedRound),
    pending: rr.pending.map((p) => ({ ...p, voters: [...p.voters] })),
    pinned: [...rr.pinned],
  };
}

/**
 * Non-mutating preview of the upcoming play order (for host + guest UIs).
 * Simulates `pickNext` forward on a clone.
 */
export function computeUpNext(rr: RoundRobinState, limit = 100): QueueItem[] {
  const sim = cloneRR(rr);
  const out: QueueItem[] = [];
  for (let i = 0; i < limit; i++) {
    const s = pickNext(sim);
    if (!s) break;
    out.push(s);
  }
  return out;
}

/** An upcoming item tagged with the round-robin round it belongs to. */
export type ScheduledItem = QueueItem & {
  /** null = host "play next" pin (jumps rounds); otherwise 1-based upcoming round. */
  round: number | null;
};

/**
 * Upcoming play order with each item tagged by its round (decision #23 surfacing).
 * Pinned items get round=null; round-robin items get 1-based rounds counting from
 * the next upcoming round, so the UI can group "Round 1 / Round 2 / ...".
 */
export function computeSchedule(rr: RoundRobinState, limit = 100): ScheduledItem[] {
  const sim = cloneRR(rr);
  const pinnedSet = new Set(rr.pinned);
  const baseRound = sim.currentRound;
  const out: ScheduledItem[] = [];
  for (let i = 0; i < limit; i++) {
    const item = pickNext(sim);
    if (!item) break;
    const round = pinnedSet.has(item.id) ? null : sim.currentRound - baseRound + 1;
    out.push({ ...item, round });
  }
  // Normalize so the earliest round-robin round is always 1 (the current round
  // may already be partly consumed by the now-playing song).
  const rounds = out.filter((o) => o.round != null).map((o) => o.round as number);
  if (rounds.length) {
    const min = Math.min(...rounds);
    for (const o of out) if (o.round != null) o.round = o.round - min + 1;
  }
  return out;
}
