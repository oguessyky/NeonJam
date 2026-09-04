// NeonJam wire protocol (decision #5: host-authoritative, dumb WS relay).
//
// Three parties: HOST (browser, authoritative), GUESTS (browser remotes),
// RELAY (dumb Node WS server, routes within a room + minimal lifecycle).
//
// Routing rules the relay enforces:
//  - control messages (host_create / host_reconnect / guest_join) are consumed
//    by the relay itself.
//  - a GUEST's `intent` is wrapped with its clientId and forwarded to the HOST.
//  - a HOST's `host_msg` is fanned out to all guests (or a single `to` guest).
//  - the relay injects presence + host-status system messages.

import { z } from "zod";
import type { PublicState, Track } from "./types";

export const PROTOCOL_VERSION = 1;

// ---------- validation schemas (guest-supplied → must be checked) ----------

export const zTrack = z.object({
  videoId: z.string().min(1).max(20),
  title: z.string().min(1).max(300),
  artist: z.string().max(300).default(""),
  cover: z.string().url().max(2000).nullable().default(null),
  durationSec: z.number().int().positive().max(86_400).nullable().default(null),
});

export const zName = z.string().trim().min(1).max(32);

export const zGuestIntent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), track: zTrack }),
  z.object({ kind: z.literal("vote"), itemId: z.string().max(40) }),
  z.object({ kind: z.literal("unvote"), itemId: z.string().max(40) }),
  z.object({ kind: z.literal("remove"), itemId: z.string().max(40) }),
  z.object({ kind: z.literal("rename"), name: zName }),
  // Vote-to-skip the currently-playing track (decision #17). itemId ties the vote
  // to a specific now-playing entry so stale votes for an already-skipped song are
  // ignored by the host.
  z.object({ kind: z.literal("skipvote"), itemId: z.string().max(40) }),
  z.object({ kind: z.literal("unskipvote"), itemId: z.string().max(40) }),
]);
export type GuestIntent = z.infer<typeof zGuestIntent>;

// ---------- messages a client SENDS to the relay ----------

export type ClientToRelay =
  | { t: "host_create" }
  | { t: "host_reconnect"; code: string; hostToken: string }
  // Re-establish a room the relay no longer has (relay restart/sleep wiped it) while
  // the host is still alive with full state. The host asks to keep its ORIGINAL code
  // + token so guests reconverge on the same code. If that code is taken by another
  // live room the relay mints a fresh one instead (host detects the change → banner).
  | { t: "host_reclaim"; code: string; hostToken: string }
  | { t: "guest_join"; code: string; clientId: string; name: string }
  | { t: "intent"; intent: GuestIntent } // guest -> (relay wraps) -> host
  | { t: "host_msg"; to?: string; msg: HostMsg } // host -> (relay fans out) -> guests
  | { t: "host_action"; action: HostAction }; // host -> relay (kick/lock/end)

export type HostAction =
  // Kick = remove + block rejoin (decision #18). `alsoIp` additionally blocks the
  // guest's network address (opt-in — may catch others on the same WiFi).
  | { kind: "kick"; clientId: string; alsoIp?: boolean }
  | { kind: "lock"; locked: boolean }
  | { kind: "end" };

// what the host pushes down to guests
export type HostMsg =
  | { kind: "state"; state: PublicState }
  | { kind: "toast"; level: "info" | "success" | "error"; text: string };

// ---------- messages the relay SENDS to clients ----------

export type RelayToClient =
  // `reclaimed` marks a room re-established via host_reclaim (relay restart recovery):
  // the host must PRESERVE its live engine/player instead of resetting. When the
  // returned `code` differs from the one requested, the desired code had collided
  // with another live room and the host got a fresh one (must re-share it).
  | { t: "room_created"; code: string; hostToken: string; reclaimed?: boolean }
  | { t: "reconnect_ok"; code: string }
  | { t: "reconnect_fail"; reason: string }
  | { t: "join_ok"; code: string }
  | { t: "join_fail"; reason: "not_found" | "full" | "locked" | "bad_name" | "banned" }
  // to host:
  | { t: "guest_joined"; clientId: string; name: string; ip?: string }
  | { t: "guest_left"; clientId: string }
  | { t: "guest_intent"; from: string; name: string; intent: GuestIntent }
  // to guests:
  | { t: "host_msg"; msg: HostMsg }
  | { t: "host_status"; status: "connected" | "disconnected" | "ended" }
  | { t: "kicked" }
  // both:
  | { t: "error"; reason: string };

export type AnyMessage = ClientToRelay | RelayToClient;

export function safeParse(raw: string): AnyMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.t === "string") return obj as AnyMessage;
    return null;
  } catch {
    return null;
  }
}

/** Normalize a validated track (fills defaults) — for host-side ingest of guest adds. */
export function normalizeTrack(input: unknown): Track | null {
  const r = zTrack.safeParse(input);
  return r.success ? r.data : null;
}
