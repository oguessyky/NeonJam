// FIFO-fair round-robin queue engine (decision #24, supersedes the vote-ranking
// of #9).
//
// Model: every song gets an IMMUTABLE round number the moment it's added, and is
// never reassigned. Play order is simply the pinned "play next" lane (#23) first,
// then the rest sorted by (round, add-time). Because rounds are immutable, adding
// a song never reshuffles what's already queued.
//
// Round assignment at add-time, for a song by contributor C:
//  - C already has pending songs  -> C's max pending round + 1 (C's own next turn).
//  - C is fresh (new, or ran out)  -> the round AFTER the about-to-play round, i.e.
//    (min pending round + 1); if the queue is empty, playingRound + 1; at the very
//    start (nothing has played), round 1.
// This means a newcomer never lands in the imminent round and never cuts ahead of
// queued songs; within a round, order is FIFO by add-time.
//
// Votes are just likes now (decision #24) — they do NOT affect order.

import type { QueueItem } from "./types";

export type RoundRobinState = {
  /** All pending songs (flat). Each carries an immutable `roundNo`. */
  pending: QueueItem[];
  /** Round of the song currently playing; 0 before anything has played. */
  playingRound: number;
  /** Host "play next" override lane (#23): ordered queue-item ids that jump ahead. */
  pinned: string[];
};

export function createRoundRobin(): RoundRobinState {
  return { pending: [], playingRound: 0, pinned: [] };
}

function roundOf(item: QueueItem): number {
  return item.roundNo ?? 1;
}

/** Assign the immutable round for a new song by `clientId` (decision #24). */
function assignRound(rr: RoundRobinState, clientId: string): number {
  let myMax = 0;
  let hasMine = false;
  let minPending = Infinity;
  for (const p of rr.pending) {
    const r = roundOf(p);
    if (p.addedBy === clientId) {
      hasMine = true;
      if (r > myMax) myMax = r;
    }
    if (r < minPending) minPending = r;
  }
  if (hasMine) return myMax + 1; // my own next turn
  if (minPending === Infinity) return rr.playingRound + 1; // queue empty (>=1)
  return minPending + 1; // fresh contributor -> round after the about-to-play round
}

/** Add a song to the queue, stamping its immutable round. */
export function addSong(rr: RoundRobinState, item: QueueItem): void {
  item.roundNo = assignRound(rr, item.addedBy);
  rr.pending.push(item);
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
}

/** Find a pending entry by videoId (duplicate detection, decision #11). */
export function findByVideoId(rr: RoundRobinState, videoId: string): QueueItem | undefined {
  return rr.pending.find((p) => p.videoId === videoId);
}

// ------------------------------------------------------------- pinned lane (#23)

export function pinNext(rr: RoundRobinState, itemId: string): void {
  if (!rr.pending.some((p) => p.id === itemId)) return;
  rr.pinned = [itemId, ...rr.pinned.filter((id) => id !== itemId)];
}

export function unpin(rr: RoundRobinState, itemId: string): void {
  rr.pinned = rr.pinned.filter((id) => id !== itemId);
}

export function setPinnedOrder(rr: RoundRobinState, order: string[]): void {
  const seen = new Set<string>();
  rr.pinned = order.filter(
    (id) => rr.pending.some((p) => p.id === id) && !seen.has(id) && seen.add(id),
  );
}

// ------------------------------------------------------------------- ordering

/** The non-pinned pending songs in play order: (round, add-time). */
function orderedRest(rr: RoundRobinState): QueueItem[] {
  const pinnedSet = new Set(rr.pinned);
  return rr.pending
    .filter((p) => !pinnedSet.has(p.id))
    .sort((a, b) => roundOf(a) - roundOf(b) || a.addedAt - b.addedAt);
}

/**
 * Pop the next song to play. Pinned lane first (pure override, doesn't advance the
 * round counter), then the FIFO-fair order. Mutates `rr`.
 */
export function pickNext(rr: RoundRobinState): QueueItem | undefined {
  while (rr.pinned.length) {
    const id = rr.pinned.shift()!;
    const idx = rr.pending.findIndex((p) => p.id === id);
    if (idx !== -1) return rr.pending.splice(idx, 1)[0]; // override: leave playingRound
  }
  const rest = orderedRest(rr);
  const next = rest[0];
  if (!next) return undefined;
  rr.pending = rr.pending.filter((p) => p.id !== next.id);
  rr.playingRound = Math.max(rr.playingRound, roundOf(next));
  return next;
}

/** An upcoming item tagged with its display round (null when pinned). */
export type ScheduledItem = QueueItem & { round: number | null };

/**
 * Upcoming play order for the UIs. Pure (no simulation): pinned lane first, then
 * the FIFO-fair order, with internal round numbers compacted to 1-based display
 * rounds so there are no confusing gaps.
 */
export function computeSchedule(rr: RoundRobinState, limit = 100): ScheduledItem[] {
  const pinnedSet = new Set(rr.pinned);
  const pinnedItems: ScheduledItem[] = rr.pinned
    .map((id) => rr.pending.find((p) => p.id === id))
    .filter((p): p is QueueItem => !!p)
    .map((p) => ({ ...p, round: null }));

  const rest = orderedRest(rr);
  const distinct = [...new Set(rest.map(roundOf))].sort((a, b) => a - b);
  const displayRound = new Map(distinct.map((r, i) => [r, i + 1]));
  const restItems: ScheduledItem[] = rest.map((p) => ({
    ...p,
    round: displayRound.get(roundOf(p)) ?? 1,
  }));

  return [...pinnedItems, ...restItems].slice(0, limit);
}
