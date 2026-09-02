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

type Engine = {
  code: string;
  hostToken: string;
  rr: RoundRobinState;
  members: Map<string, Member>;
  nowPlaying: NowPlaying | null;
  radioEnabled: boolean;
  locked: boolean;
};

type Snapshot = {
  code: string;
  hostToken: string;
  radioEnabled: boolean;
  locked: boolean;
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
  members: Member[];
  nowPlaying: NowPlaying | null;
  upNext: ScheduledItem[];
  /** Ordered ids in the "play next" lane (decision #23) — a subset of upNext. */
  pinnedIds: string[];
  guestCount: number;
};

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

export function useHost() {
  const [view, setView] = useState<HostView>({
    status: "connecting",
    code: "",
    joinUrl: "",
    locked: false,
    radioEnabled: true,
    members: [],
    nowPlaying: null,
    upNext: [],
    pinnedIds: [],
    guestCount: 0,
  });

  const engineRef = useRef<Engine | null>(null);
  const relayRef = useRef<RelayClient | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerReadyRef = useRef(false);
  const radioLoadingRef = useRef(false);

  // --- snapshot (host resilience #13) --------------------------------------
  const saveSnapshot = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const snap: Snapshot = {
      code: e.code,
      hostToken: e.hostToken,
      radioEnabled: e.radioEnabled,
      locked: e.locked,
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
    return {
      code: e.code,
      locked: e.locked,
      radioEnabled: e.radioEnabled,
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
    setView((v) => ({
      ...v,
      code: e.code,
      joinUrl: typeof window !== "undefined" ? `${window.location.origin}/j/${e.code}` : "",
      locked: e.locked,
      radioEnabled: e.radioEnabled,
      members: [...e.members.values()],
      nowPlaying: e.nowPlaying,
      upNext: computeSchedule(e.rr, 60),
      pinnedIds: [...e.rr.pinned],
      guestCount: [...e.members.values()].filter((m) => !m.isHost && m.connected).length,
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
      e.nowPlaying = {
        ...item,
        anchorMs: Date.now(),
        positionSec: 0,
        isPlaying: true,
      };
      if (playerReadyRef.current && playerRef.current) {
        playerRef.current.loadVideoById(item.videoId);
      }
      sync();
    },
    [sync],
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
    [advance, sync, toast],
  );

  // --- relay wiring --------------------------------------------------------
  useEffect(() => {
    // Try resilient reconnect first (#13).
    let snap: Snapshot | null = null;
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (Date.now() - parsed.savedAt < 60_000) snap = parsed;
      }
    } catch {
      /* ignore */
    }

    const relay = new RelayClient({
      onOpen: () => {
        if (snap) {
          relay.send({ t: "host_reconnect", code: snap.code, hostToken: snap.hostToken });
        } else {
          relay.send({ t: "host_create" });
        }
      },
      onMessage: (msg) => {
        const e = engineRef.current;
        switch (msg.t) {
          case "room_created": {
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
            };
            setView((v) => ({ ...v, status: "live" }));
            sync();
            break;
          }
          case "reconnect_ok": {
            // restore engine from snapshot
            const s = snap!;
            const rr = createRoundRobin();
            rr.pending = s.rr.pending;
            rr.playingRound = s.rr.playingRound ?? 0;
            rr.lastRound = s.rr.lastRound ?? {};
            rr.pinned = s.rr.pinned ?? [];
            engineRef.current = {
              code: s.code,
              hostToken: s.hostToken,
              rr,
              members: new Map([
                [HOST_ID, { clientId: HOST_ID, name: "Host", isHost: true, connected: true }],
              ]),
              nowPlaying: s.nowPlaying,
              radioEnabled: s.radioEnabled,
              locked: s.locked,
            };
            setView((v) => ({ ...v, status: "live" }));
            // resume playback where we left off
            if (s.nowPlaying && playerReadyRef.current && playerRef.current) {
              playerRef.current.loadVideoById(s.nowPlaying.videoId);
            }
            sync();
            break;
          }
          case "reconnect_fail": {
            snap = null;
            try {
              localStorage.removeItem(SNAP_KEY);
            } catch {
              /* ignore */
            }
            relay.send({ t: "host_create" });
            break;
          }
          case "guest_joined": {
            if (!e) break;
            const existing = e.members.get(msg.clientId);
            if (existing) {
              existing.connected = true;
              existing.name = msg.name;
            } else {
              e.members.set(msg.clientId, {
                clientId: msg.clientId,
                name: msg.name,
                isHost: false,
                connected: true,
              });
            }
            sync();
            break;
          }
          case "guest_left": {
            if (!e) break;
            const m = e.members.get(msg.clientId);
            if (m) m.connected = false; // keep/orphan by default (#21)
            sync();
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
        if (e2?.nowPlaying) p.loadVideoById(e2.nowPlaying.videoId);
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
    toggleLock: useCallback(() => {
      const e = engineRef.current;
      if (!e) return;
      e.locked = !e.locked;
      relayRef.current?.send({ t: "host_action", action: { kind: "lock", locked: e.locked } });
      sync();
    }, [sync]),
    kick: useCallback(
      (clientId: string) => {
        const e = engineRef.current;
        if (!e) return;
        removeContributor(e.rr, clientId); // purge their songs (#18)
        e.members.delete(clientId);
        relayRef.current?.send({ t: "host_action", action: { kind: "kick", clientId } });
        sync();
      },
      [sync],
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
