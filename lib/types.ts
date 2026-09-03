// Shared domain types for NeonJam.
// Used by both the host controller (browser) and guest remotes (browser).

/** A YouTube track as surfaced by search / URL-paste. */
export type Track = {
  videoId: string;
  title: string;
  artist: string;
  /** Thumbnail URL (an <img> src only — never audio; safe to be cross-origin). */
  cover: string | null;
  durationSec: number | null;
};

/** A track sitting in the queue, with attribution + votes. */
export type QueueItem = Track & {
  /** Unique per queue entry (not the videoId — same video could exist as radio filler etc). */
  id: string;
  /** clientId of the guest who added it, or "host". */
  addedBy: string;
  addedByName: string;
  /** clientIds who upvoted this entry. */
  voters: string[];
  addedAt: number;
  /** True when auto-added by the empty-queue radio (decision #10). */
  isRadio?: boolean;
  /**
   * Immutable round assigned at add-time (decision #24). Do not recompute — this
   * is what keeps the queue from reshuffling when new songs arrive.
   */
  roundNo?: number;
};

/** The currently-playing track plus a host-clock anchor for guest interpolation. */
export type NowPlaying = QueueItem & {
  /**
   * Host epoch (ms) at which the current `positionSec` was true.
   * Guests interpolate: displayedPos = positionSec + (isPlaying ? (now - anchorMs)/1000 : 0).
   */
  anchorMs: number;
  positionSec: number;
  isPlaying: boolean;
};

export type Member = {
  clientId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  /**
   * Coarse network address reported by the relay (decision: clientId is the real
   * identity; IP is a weak visibility hint only). Ephemeral — never persisted to
   * the host snapshot. Often identical for every guest on the party WiFi.
   */
  ip?: string;
};

/**
 * The recipient-agnostic snapshot the host broadcasts to all guests via the relay.
 * Guests derive their own `youVoted` from voterIds + their clientId.
 */
export type PublicState = {
  code: string;
  locked: boolean;
  radioEnabled: boolean;
  /** Host has vote-to-skip enabled (decision #17). */
  voteSkipEnabled: boolean;
  members: Array<{ clientId: string; name: string; connected: boolean; isHost: boolean }>;
  nowPlaying: NowPlaying | null;
  /** Round-robin-ordered preview of what plays next (decision #9). */
  upNext: PublicQueueItem[];
  /**
   * Live vote-to-skip tally for the current track (decision #17), or null when
   * nothing is playing / the feature is off. `voterIds` lets a guest derive
   * whether they've voted; `needed` is the majority threshold of connected guests.
   */
  skip: { voterIds: string[]; needed: number } | null;
  /** Server/host epoch (ms) this snapshot was built — lets guests discard stale ones. */
  rev: number;
};

export type PublicQueueItem = {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  cover: string | null;
  durationSec: number | null;
  addedBy: string;
  addedByName: string;
  voterIds: string[];
  isRadio?: boolean;
  /** Host bumped this to "play next" (decision #23). */
  isPinned?: boolean;
  /** Round-robin round (1-based) this song plays in; null when pinned. */
  round: number | null;
};

export const ROOM_CAPACITY = 20; // decision #20
export const HOST_RECONNECT_GRACE_MS = 60_000; // decision #13
export const GUEST_RECONNECT_GRACE_MS = 45_000; // decision #21
