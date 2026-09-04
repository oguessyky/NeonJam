// Host controller (decisions #2, #5, #8-#14, #18). The host browser is the single
// source of truth: it owns the round-robin engine, drives the hidden IFrame player,
// processes guest intents relayed to it, and broadcasts PublicState back to guests.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  createRoundRobin,
  addSong,
  removeSong,
  removeContributor,
  findByVideoId,
  pickNext,
  computeSchedule,
  type ScheduledItem,
  pinNext,
  unpin,
  setPinnedOrder,
  type RoundRobinState,
} from "./roundrobin";
import type { NowPlaying, PublicState, Track, QueueItem, Member } from "./types";
import { RelayClient } from "./relay-client";
import { normalizeTrack, type GuestIntent } from "./protocol";
import { createPlayer, YT_STATE, type YTPlayer } from "./yt-iframe";

const SNAP_KEY = "neonjam.host.snapshot";
const HOST_ID = "host";
// A cold page-reload can reclaim its room this long after the last save (#13 + the
// room-follows-host reclaim path). Generous so a host who reopens the tab mid-party
// gets the same code + queue back; still expires so a snapshot from a long-dead
// party doesn't resurrect a zombie room.
const SNAP_TTL_MS = 2 * 60 * 60 * 1000; // ~2h

type Engine = {
  code: string;
  hostToken: string;
  rr: RoundRobinState;
  members: Map<string, Member>;
  nowPlaying: NowPlaying | null;
  radioEnabled: boolean;
  locked: boolean;
  voteSkipEnabled: boolean;
  /** clientIds who voted to skip the CURRENT track. Reset on every track change. */
  skipVoters: Set<string>;
};

type Snapshot = {
  code: string;
  hostToken: string;
  radioEnabled: boolean;
  locked: boolean;
  voteSkipEnabled: boolean;
  nowPlaying: NowPlaying | null;
  rr: {
    pending: QueueItem[];
    playingRound: number;
    lastRound: Record<string, number>;
    pinned: string[];
  };
  savedAt: number;
};

export type HostView = {
  status: "connecting" | "live" | "reconnecting" | "ended";
  code: string;
  joinUrl: string;
  locked: boolean;
  radioEnabled: boolean;
  voteSkipEnabled: boolean;
  members: Member[];
  nowPlaying: NowPlaying | null;
  upNext: ScheduledItem[];
  /** Ordered ids in the "play next" lane (decision #23) — a subset of upNext. */
  pinnedIds: string[];
  guestCount: number;
  /** Live vote-to-skip tally for the current track (connected voters / needed). */
  skipVotes: number;
  skipNeeded: number;
  /**
   * Browser blocked autoplay (no user gesture yet) — the first song is loaded but
   * won't start until the host taps once. Drives a "tap to start" overlay.
   */
  needsGesture: boolean;
  /**
   * Set to the NEW room code when a reclaim collided and the room had to move to a
   * fresh code (the original was taken by another live room). Drives a loud banner
   * telling the host to re-share it. null on a clean reclaim (code unchanged).
   */
  reclaimedCode: string | null;
};

// Rebuild the authoritative engine from a saved snapshot (used by both the cold
// page-reload reconnect and the cold reclaim path). `code`/`hostToken` may differ
// from the snapshot's own when a reclaim collided and got a fresh code.
function engineFromSnap(s: Snapshot, code: string, hostToken: string): Engine {
  const rr = createRoundRobin();
  rr.pending = s.rr.pending;
  rr.playingRound = s.rr.playingRound ?? 0;
  rr.lastRound = s.rr.lastRound ?? {};
  rr.pinned = s.rr.pinned ?? [];
  return {
    code,
    hostToken,
    rr,
    members: new Map([
      [HOST_ID, { clientId: HOST_ID, name: "Host", isHost: true, connected: true }],
    ]),
    nowPlaying: s.nowPlaying,
    radioEnabled: s.radioEnabled,
    locked: s.locked,
    voteSkipEnabled: s.voteSkipEnabled ?? true,
    skipVoters: new Set(), // votes don't survive a host reload
  };
}

function newItem(track: Track, addedBy: string): QueueItem {
  return {
    ...track,
    id: nanoid(10),
    addedBy,
    addedByName: addedBy === HOST_ID ? "Host" : addedBy,
    // No auto self-vote — a song starts at 0 votes so the upvote control reads
    // clearly (and doesn't pre-fill your own songs to "1").
    voters: [],
    addedAt: Date.now(),
  };
}

/**
 * Vote-to-skip tally (decision #17): majority of CONNECTED guests (host excluded).
 * Votes from disconnected guests are dropped so the denominator stays honest.
 */
function computeSkip(e: Engine): { voterIds: string[]; votes: number; needed: number } {
  const connected = [...e.members.values()].filter((m) => !m.isHost && m.connected);
  const connectedIds = new Set(connected.map((m) => m.clientId));
  const voterIds = [...e.skipVoters].filter((id) => connectedIds.has(id));
  const needed = connected.length > 0 ? Math.floor(connected.length / 2) + 1 : 0;
  return { voterIds, votes: voterIds.length, needed };
}

export function useHost() {
  const [view, setView] = useState<HostView>({
    status: "connecting",
    code: "",
    joinUrl: "",
    locked: false,
    radioEnabled: true,
    voteSkipEnabled: true,
    members: [],
    nowPlaying: null,
    upNext: [],
    pinnedIds: [],
    guestCount: 0,
    skipVotes: 0,
    skipNeeded: 0,
    needsGesture: false,
    reclaimedCode: null,
  });

  const engineRef = useRef<Engine | null>(null);
  const relayRef = useRef<RelayClient | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);
  const radioLoadingRef = useRef(false);
  // Last videoId handed to the IFrame player. Loading the SAME id while the player
  // sits in the ENDED state is a no-op in the YT API, which is why a just-finished
  // song silently refused to replay when re-queued (bug; DESIGN #22 says it must).
  const lastLoadedRef = useRef<string | null>(null);
  // Detects blocked autoplay: after we try to play a track, if the player hasn't
  // actually started shortly after, the browser is waiting for a user gesture.
  const gestureCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The code we last asked the relay to reclaim — compared against the granted code
  // to detect a collision (relay had to move us to a fresh code).
  const reclaimRequestedRef = useRef<string | null>(null);

  // Single entry point for driving the player to a video. Handles the ENDED
  // same-id case by rewinding + playing instead of a dead reload.
  const loadVideo = useCallback((videoId: string) => {
    const p = playerRef.current;
    if (!playerReadyRef.current || !p) return;
    if (lastLoadedRef.current === videoId) {
      p.seekTo(0, true);
      p.playVideo();
    } else {
      p.loadVideoById(videoId);
    }
    lastLoadedRef.current = videoId;
  }, []);

  // --- snapshot (host resilience #13) --------------------------------------
  const saveSnapshot = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const snap: Snapshot = {
      code: e.code,
      hostToken: e.hostToken,
      radioEnabled: e.radioEnabled,
      locked: e.locked,
      voteSkipEnabled: e.voteSkipEnabled,
      nowPlaying: e.nowPlaying,
      rr: {
        pending: e.rr.pending,
        playingRound: e.rr.playingRound,
        lastRound: e.rr.lastRound,
        pinned: e.rr.pinned,
      },
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch {
      /* ignore */
    }
  }, []);

  const buildPublicState = useCallback((): PublicState => {
    const e = engineRef.current!;
    const skip = computeSkip(e);
    return {
      code: e.code,
      locked: e.locked,
      radioEnabled: e.radioEnabled,
      voteSkipEnabled: e.voteSkipEnabled,
      skip:
        e.voteSkipEnabled && e.nowPlaying
          ? { voterIds: skip.voterIds, needed: skip.needed }
          : null,
      members: [...e.members.values()].map((m) => ({
        clientId: m.clientId,
        name: m.name,
        connected: m.connected,
        isHost: m.isHost,
      })),
      nowPlaying: e.nowPlaying,
      upNext: computeSchedule(e.rr, 60).map((q) => ({
        id: q.id,
        videoId: q.videoId,
        title: q.title,
        artist: q.artist,
        cover: q.cover,
        durationSec: q.durationSec,
        addedBy: q.addedBy,
        addedByName: q.addedByName,
        voterIds: q.voters,
        isRadio: q.isRadio,
        isPinned: e.rr.pinned.includes(q.id),
        round: q.round,
      })),
      rev: Date.now(),
    };
  }, []);

  // Re-render the host UI, persist, and broadcast to guests.
  const sync = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const skip = computeSkip(e);
    setView((v) => ({
      ...v,
      code: e.code,
      joinUrl: typeof window !== "undefined" ? `${window.location.origin}/j/${e.code}` : "",
      locked: e.locked,
      radioEnabled: e.radioEnabled,
      voteSkipEnabled: e.voteSkipEnabled,
      members: [...e.members.values()],
      nowPlaying: e.nowPlaying,
      upNext: computeSchedule(e.rr, 60),
      pinnedIds: [...e.rr.pinned],
      guestCount: [...e.members.values()].filter((m) => !m.isHost && m.connected).length,
      skipVotes: e.voteSkipEnabled && e.nowPlaying ? skip.votes : 0,
      skipNeeded: e.voteSkipEnabled && e.nowPlaying ? skip.needed : 0,
    }));
    saveSnapshot();
    relayRef.current?.send({ t: "host_msg", msg: { kind: "state", state: buildPublicState() } });
  }, [buildPublicState, saveSnapshot]);

  const toast = useCallback(
    (to: string, level: "info" | "success" | "error", text: string) => {
      relayRef.current?.send({ t: "host_msg", to, msg: { kind: "toast", level, text } });
    },
    [],
  );

  // --- playback ------------------------------------------------------------
  const playTrack = useCallback(
    (item: QueueItem) => {
      const e = engineRef.current!;
      e.skipVoters = new Set(); // fresh track ⇒ fresh vote-to-skip tally (#17)
      e.nowPlaying = {
        ...item,
        anchorMs: Date.now(),
        positionSec: 0,
        isPlaying: true,
      };
      loadVideo(item.videoId);
      // If the player isn't actually playing a moment later, autoplay was blocked
      // (no user gesture yet) → prompt a one-tap start. Once it plays, PLAYING
      // clears it; after the first tap all later tracks autoplay normally.
      if (gestureCheckRef.current) clearTimeout(gestureCheckRef.current);
      gestureCheckRef.current = setTimeout(() => {
        const p = playerRef.current;
        if (!p) return;
        const st = p.getPlayerState();
        const started = st === YT_STATE.PLAYING || st === YT_STATE.BUFFERING;
        if (!started) setView((v) => (v.needsGesture ? v : { ...v, needsGesture: true }));
      }, 1600);
      sync();
    },
    [sync, loadVideo],
  );

  const fillRadio = useCallback(async () => {
    const e = engineRef.current!;
    if (radioLoadingRef.current) return;
    const seed = e.nowPlaying?.videoId;
    if (!seed) return;
    radioLoadingRef.current = true;
    try {
      const res = await fetch(`/api/radio?seed=${encodeURIComponent(seed)}`);
      const data = await res.json();
      const tracks: Track[] = (data.results ?? [])
        .map((t: unknown) => normalizeTrack(t))
        .filter(Boolean) as Track[];
      for (const t of tracks) {
        if (findByVideoId(e.rr, t.videoId)) continue;
        const item = newItem(t, HOST_ID);
        item.isRadio = true;
        addSong(e.rr, item);
      }
    } catch {
      /* ignore */
    } finally {
      radioLoadingRef.current = false;
    }
  }, []);

  const advance = useCallback(async () => {
    const e = engineRef.current!;
    let next = pickNext(e.rr);
    if (!next && e.radioEnabled) {
      await fillRadio();
      next = pickNext(e.rr);
    }
    if (next) {
      playTrack(next);
    } else {
      e.nowPlaying = null;
      sync();
    }
  }, [fillRadio, playTrack, sync]);

  // If enough CONNECTED guests have voted to skip (majority, host excluded #17),
  // advance. Called after any skip-vote OR any membership change (a departing
  // voter/non-voter shifts the ratio). Returns true if it triggered a skip.
  const maybeAutoSkip = useCallback((): boolean => {
    const e = engineRef.current;
    if (!e || !e.voteSkipEnabled || !e.nowPlaying) return false;
    const { votes, needed } = computeSkip(e);
    if (needed > 0 && votes >= needed) {
      void advance();
      return true;
    }
    return false;
  }, [advance]);

  // --- guest intent handling (#8, #11) -------------------------------------
  const handleIntent = useCallback(
    (from: string, name: string, intent: GuestIntent) => {
      const e = engineRef.current!;
      switch (intent.kind) {
        case "add": {
          const track = normalizeTrack(intent.track);
          if (!track) return;
          const dup = findByVideoId(e.rr, track.videoId);
          const playingDup = e.nowPlaying?.videoId === track.videoId;
          if (dup) {
            if (!dup.voters.includes(from)) dup.voters.push(from);
            toast(from, "info", "Already queued — bumped it 👍");
            sync();
            return;
          }
          if (playingDup) {
            toast(from, "info", "That's playing right now 🎶");
            return;
          }
          const item = newItem(track, from);
          item.addedByName = name;
          addSong(e.rr, item);
          const wasIdle = !e.nowPlaying;
          if (wasIdle) {
            void advance();
          } else {
            sync();
          }
          toast(from, "success", "Added to the queue");
          return;
        }
        case "vote":
        case "unvote": {
          const target =
            e.rr.pending.find((p) => p.id === intent.itemId) ??
            (e.nowPlaying && e.nowPlaying.id === intent.itemId ? e.nowPlaying : null);
          if (!target) return;
          const has = target.voters.includes(from);
          if (intent.kind === "vote" && !has) target.voters.push(from);
          if (intent.kind === "unvote" && has)
            target.voters = target.voters.filter((v) => v !== from);
          sync();
          return;
        }
        case "skipvote":
        case "unskipvote": {
          // Vote only counts for the track actually playing right now (#17) — a
          // stale vote for an already-skipped song id is ignored.
          if (!e.voteSkipEnabled) return;
          if (!e.nowPlaying || e.nowPlaying.id !== intent.itemId) return;
          if (intent.kind === "skipvote") e.skipVoters.add(from);
          else e.skipVoters.delete(from);
          if (!maybeAutoSkip()) sync(); // auto-skip already re-syncs on advance
          return;
        }
        case "remove": {
          const item = e.rr.pending.find((p) => p.id === intent.itemId);
          if (!item) return;
          if (item.addedBy !== from) {
            toast(from, "error", "You can only remove your own songs");
            return;
          }
          removeSong(e.rr, intent.itemId);
          sync();
          return;
        }
        case "rename": {
          const m = e.members.get(from);
          if (m) {
            m.name = intent.name;
            // update attribution on their pending songs
            for (const p of e.rr.pending) if (p.addedBy === from) p.addedByName = intent.name;
            sync();
          }
          return;
        }
      }
    },
    [advance, sync, toast, maybeAutoSkip],
  );

  // --- relay wiring --------------------------------------------------------
  useEffect(() => {
    // Try resilient reconnect first (#13).
    let snap: Snapshot | null = null;
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (Date.now() - parsed.savedAt < SNAP_TTL_MS) snap = parsed;
      }
    } catch {
      /* ignore */
    }

    const relay = new RelayClient({
      onOpen: () => {
        const e = engineRef.current;
        if (e) {
          // WARM: the WS dropped and reconnected while the host is still alive and
          // playing. Reconnect to the LIVE room — not the mount-time snapshot, which
          // is null for a room created this session (that stale-null path is exactly
          // what silently minted a new room on every reconnect).
          relay.send({ t: "host_reconnect", code: e.code, hostToken: e.hostToken });
        } else if (snap) {
          // COLD: page reload with a saved snapshot — try to rejoin that room.
          relay.send({ t: "host_reconnect", code: snap.code, hostToken: snap.hostToken });
        } else {
          relay.send({ t: "host_create" });
        }
      },
      onMessage: (msg) => {
        const e = engineRef.current;
        switch (msg.t) {
          case "room_created": {
            const requested = reclaimRequestedRef.current;
            reclaimRequestedRef.current = null;
            // A collision reclaim moved us to a fresh code — warn the host to re-share.
            const movedCode = msg.reclaimed && requested != null && requested !== msg.code;

            if (msg.reclaimed && engineRef.current) {
              // WARM reclaim: the relay lost the room but our engine + player are
              // alive. Keep ALL state and the currently-playing song untouched — just
              // adopt the (possibly new) code + token and re-broadcast so guests
              // reconverge. Never touch the player here (decision: no interruption).
              const eng = engineRef.current;
              eng.code = msg.code;
              eng.hostToken = msg.hostToken;
              setView((v) => ({ ...v, status: "live", reclaimedCode: movedCode ? msg.code : null }));
              sync();
              break;
            }
            if (msg.reclaimed && snap) {
              // COLD reclaim: room gone AND we have no live engine (page was reloaded
              // after the snapshot's reconnect grace). Rebuild from the snapshot and
              // resume playback (player was destroyed, so loadVideo IS correct here).
              engineRef.current = engineFromSnap(snap, msg.code, msg.hostToken);
              setView((v) => ({ ...v, status: "live", reclaimedCode: movedCode ? msg.code : null }));
              if (snap.nowPlaying) loadVideo(snap.nowPlaying.videoId);
              sync();
              break;
            }
            // FRESH room (first-time create).
            engineRef.current = {
              code: msg.code,
              hostToken: msg.hostToken,
              rr: createRoundRobin(),
              members: new Map([
                [HOST_ID, { clientId: HOST_ID, name: "Host", isHost: true, connected: true }],
              ]),
              nowPlaying: null,
              radioEnabled: true,
              locked: false,
              voteSkipEnabled: true,
              skipVoters: new Set(),
            };
            setView((v) => ({ ...v, status: "live" }));
            sync();
            break;
          }
          case "reconnect_ok": {
            if (engineRef.current) {
              // WARM: WS reconnected while the host stayed alive — the room still
              // exists and our engine is authoritative. Do NOT rebuild from the
              // snapshot and do NOT reload the player; just re-broadcast state.
              setView((v) => ({ ...v, status: "live" }));
              sync();
              break;
            }
            // COLD: page reload — rebuild the engine from the snapshot and resume.
            const s = snap!;
            engineRef.current = engineFromSnap(s, s.code, s.hostToken);
            setView((v) => ({ ...v, status: "live" }));
            if (s.nowPlaying) loadVideo(s.nowPlaying.videoId);
            sync();
            break;
          }
          case "reconnect_fail": {
            // The relay no longer has the room (restart/sleep wiped it, or it was
            // unreachable past the grace window). Instead of silently minting a new
            // random room, RECLAIM our original code so guests reconverge.
            const eng = engineRef.current;
            if (eng) {
              // WARM: host alive with full state — reclaim, keep playing.
              reclaimRequestedRef.current = eng.code;
              relay.send({ t: "host_reclaim", code: eng.code, hostToken: eng.hostToken });
            } else if (snap) {
              // COLD: reclaim from the snapshot; engine rebuilt on room_created.
              reclaimRequestedRef.current = snap.code;
              relay.send({ t: "host_reclaim", code: snap.code, hostToken: snap.hostToken });
            } else {
              relay.send({ t: "host_create" });
            }
            break;
          }
          case "guest_joined": {
            if (!e) break;
            const existing = e.members.get(msg.clientId);
            if (existing) {
              existing.connected = true;
              existing.name = msg.name;
              if (msg.ip) existing.ip = msg.ip;
            } else {
              e.members.set(msg.clientId, {
                clientId: msg.clientId,
                name: msg.name,
                isHost: false,
                connected: true,
                ip: msg.ip,
              });
            }
            sync();
            break;
          }
          case "guest_left": {
            if (!e) break;
            const m = e.members.get(msg.clientId);
            if (m) m.connected = false; // keep/orphan by default (#21)
            // A departing guest shifts the vote-to-skip ratio — a skip may now pass.
            if (!maybeAutoSkip()) sync();
            break;
          }
          case "guest_intent": {
            if (!e) break;
            handleIntent(msg.from, msg.name, msg.intent);
            break;
          }
        }
      },
      onClose: () => {
        setView((v) => (v.status === "ended" ? v : { ...v, status: "reconnecting" }));
      },
    });
    relayRef.current = relay;
    relay.connect();

    // --- player setup ---
    let cancelled = false;
    createPlayer("neonjam-player", {
      onReady: (p) => {
        if (cancelled) return;
        playerRef.current = p;
        playerReadyRef.current = true;
        const e2 = engineRef.current;
        if (e2?.nowPlaying) loadVideo(e2.nowPlaying.videoId);
      },
      onStateChange: (state, p) => {
        const e2 = engineRef.current;
        if (!e2) return;
        if (state === YT_STATE.ENDED) {
          void advance();
        } else if (state === YT_STATE.PLAYING) {
          if (e2.nowPlaying) {
            e2.nowPlaying.isPlaying = true;
            e2.nowPlaying.positionSec = p.getCurrentTime();
            e2.nowPlaying.anchorMs = Date.now();
            if (!e2.nowPlaying.durationSec) {
              const d = p.getDuration();
              if (d) e2.nowPlaying.durationSec = Math.round(d);
            }
          }
          // Playback actually started ⇒ dismiss any tap-to-start prompt.
          setView((v) => (v.needsGesture ? { ...v, needsGesture: false } : v));
          sync();
        } else if (state === YT_STATE.PAUSED) {
          if (e2.nowPlaying) {
            e2.nowPlaying.isPlaying = false;
            e2.nowPlaying.positionSec = p.getCurrentTime();
            e2.nowPlaying.anchorMs = Date.now();
          }
          sync();
        }
      },
      onError: () => {
        // un-embeddable / removed video (#1 caveat) — skip it.
        void advance();
      },
    }).catch(() => {});

    // periodic resync heartbeat so late joiners / drift stay correct
    const hb = setInterval(() => {
      const e2 = engineRef.current;
      if (e2?.nowPlaying && playerRef.current && playerReadyRef.current) {
        e2.nowPlaying.positionSec = playerRef.current.getCurrentTime();
        e2.nowPlaying.anchorMs = Date.now();
      }
      if (engineRef.current) sync();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(hb);
      if (gestureCheckRef.current) clearTimeout(gestureCheckRef.current);
      relay.close();
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- host DJ controls (#8) ----------------------------------------------
  const controls = {
    playPause: useCallback(() => {
      const e = engineRef.current;
      const p = playerRef.current;
      if (!e?.nowPlaying || !p) return;
      if (e.nowPlaying.isPlaying) p.pauseVideo();
      else p.playVideo();
    }, []),
    // The user gesture that satisfies the browser's autoplay policy — kicks off
    // the loaded track and dismisses the tap-to-start overlay.
    resume: useCallback(() => {
      playerRef.current?.playVideo();
      setView((v) => ({ ...v, needsGesture: false }));
    }, []),
    skip: useCallback(() => {
      void advance();
    }, [advance]),
    seek: useCallback((sec: number) => {
      playerRef.current?.seekTo(sec, true);
    }, []),
    removeAny: useCallback(
      (itemId: string) => {
        const e = engineRef.current;
        if (!e) return;
        removeSong(e.rr, itemId);
        sync();
      },
      [sync],
    ),
    pinNext: useCallback(
      (itemId: string) => {
        const e = engineRef.current;
        if (!e) return;
        pinNext(e.rr, itemId);
        sync();
      },
      [sync],
    ),
    unpin: useCallback(
      (itemId: string) => {
        const e = engineRef.current;
        if (!e) return;
        unpin(e.rr, itemId);
        sync();
      },
      [sync],
    ),
    reorderPinned: useCallback(
      (orderedIds: string[]) => {
        const e = engineRef.current;
        if (!e) return;
        setPinnedOrder(e.rr, orderedIds);
        sync();
      },
      [sync],
    ),
    addAsHost: useCallback(
      (track: Track) => {
        const e = engineRef.current;
        if (!e) return;
        if (findByVideoId(e.rr, track.videoId) || e.nowPlaying?.videoId === track.videoId) return;
        const item = newItem(track, HOST_ID);
        addSong(e.rr, item);
        if (!e.nowPlaying) void advance();
        else sync();
      },
      [advance, sync],
    ),
    toggleRadio: useCallback(() => {
      const e = engineRef.current;
      if (!e) return;
      e.radioEnabled = !e.radioEnabled;
      sync();
    }, [sync]),
    toggleVoteSkip: useCallback(() => {
      const e = engineRef.current;
      if (!e) return;
      e.voteSkipEnabled = !e.voteSkipEnabled;
      if (!e.voteSkipEnabled) e.skipVoters = new Set(); // drop the tally when off
      sync();
    }, [sync]),
    toggleLock: useCallback(() => {
      const e = engineRef.current;
      if (!e) return;
      e.locked = !e.locked;
      relayRef.current?.send({ t: "host_action", action: { kind: "lock", locked: e.locked } });
      sync();
    }, [sync]),
    kick: useCallback(
      // Kick = remove + block rejoin (#18). `alsoIp` additionally blocks their
      // network (opt-in — the relay warns it may catch other same-WiFi guests).
      (clientId: string, alsoIp = false) => {
        const e = engineRef.current;
        if (!e) return;
        removeContributor(e.rr, clientId); // purge their songs (#18)
        e.skipVoters.delete(clientId);
        e.members.delete(clientId);
        relayRef.current?.send({ t: "host_action", action: { kind: "kick", clientId, alsoIp } });
        if (!maybeAutoSkip()) sync();
      },
      [sync, maybeAutoSkip],
    ),
    dropGuestSongs: useCallback(
      (clientId: string) => {
        const e = engineRef.current;
        if (!e) return;
        removeContributor(e.rr, clientId); // host tidies a departed guest (#21)
        sync();
      },
      [sync],
    ),
    dismissReclaimNotice: useCallback(() => {
      setView((v) => (v.reclaimedCode ? { ...v, reclaimedCode: null } : v));
    }, []),
    end: useCallback(() => {
      relayRef.current?.send({ t: "host_action", action: { kind: "end" } });
      try {
        localStorage.removeItem(SNAP_KEY);
      } catch {
        /* ignore */
      }
      setView((v) => ({ ...v, status: "ended" }));
    }, []),
  };

  return { view, controls };
}
