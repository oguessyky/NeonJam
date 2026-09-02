// YouTube IFrame Player API loader (decision #1). Host-only (#2, #19).
// Loads the external iframe_api script once and resolves the global YT namespace.

"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type YTPlayer = {
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (v: number) => void;
  getVolume: () => number;
  destroy: () => void;
};

// YT player state constants
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

let apiPromise: Promise<any> | null = null;

export function loadYT(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

export type CreatePlayerOpts = {
  onReady?: (p: YTPlayer) => void;
  onStateChange?: (state: number, p: YTPlayer) => void;
  onError?: (code: number, p: YTPlayer) => void;
};

export async function createPlayer(elementId: string, opts: CreatePlayerOpts): Promise<YTPlayer> {
  const YT = await loadYT();
  return new Promise<YTPlayer>((resolve) => {
    const player: YTPlayer = new YT.Player(elementId, {
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          opts.onReady?.(player);
          resolve(player);
        },
        onStateChange: (e: any) => opts.onStateChange?.(e.data, player),
        onError: (e: any) => opts.onError?.(e.data, player),
      },
    });
  });
}
