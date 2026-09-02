// Server-only InnerTube client (decision #4). Wraps youtubei.js to give us
// YouTube Music search + "radio" (watch-next) for the empty-queue autoplay (#10).
//
// This is the ONLY module that talks to YouTube's internal API. It is the
// "thin stateless relay" from the design: no storage, no downloads — it returns
// metadata + a videoId that the host's IFrame player streams directly.
//
// RISK (see DESIGN.md): InnerTube is unofficial and can change. Everything here
// is defensively coded and degrades to [] rather than throwing where possible.

import "server-only";
import { Innertube } from "youtubei.js";
import type { Track } from "./types";

let _yt: Promise<Innertube> | null = null;
function yt(): Promise<Innertube> {
  if (!_yt) {
    _yt = Innertube.create({ retrieve_player: false });
  }
  return _yt;
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Extract an 11-char YouTube video id from a URL or bare id (URL-paste, #4). */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (YT_ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return YT_ID_RE.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && YT_ID_RE.test(v)) return v;
      // /shorts/<id> or /embed/<id>
      const m = u.pathname.match(/\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function pickThumb(thumbs: any): string | null {
  const arr = thumbs?.contents ?? thumbs ?? [];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // largest available
  const best = [...arr].sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))[0];
  return best?.url ?? null;
}

function artistsOf(node: any): string {
  const a = node?.artists;
  if (Array.isArray(a) && a.length) return a.map((x: any) => x?.name).filter(Boolean).join(", ");
  return (
    node?.author?.name ??
    node?.author ??
    (typeof node?.subtitle?.toString === "function" ? node.subtitle.toString() : "") ??
    ""
  );
}

function toTrack(node: any): Track | null {
  const videoId: string | undefined = node?.id ?? node?.video_id ?? node?.videoId;
  const title: string | undefined =
    typeof node?.title === "string" ? node.title : node?.title?.text ?? node?.name;
  if (!videoId || !YT_ID_RE.test(videoId) || !title) return null;
  const durationSec: number | null =
    node?.duration?.seconds ?? node?.duration_seconds ?? node?.length_seconds ?? null;
  return {
    videoId,
    title,
    artist: artistsOf(node) || "",
    cover: pickThumb(node?.thumbnail ?? node?.thumbnails),
    durationSec: typeof durationSec === "number" ? durationSec : null,
  };
}

/** Walk an arbitrary youtubei.js result and collect song/video-like nodes. */
function harvest(obj: any, out: Track[], seen: Set<string>, limit: number): void {
  if (out.length >= limit || !obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const el of obj) harvest(el, out, seen, limit);
    return;
  }
  const t = toTrack(obj);
  if (t && !seen.has(t.videoId)) {
    seen.add(t.videoId);
    out.push(t);
  }
  for (const key of ["contents", "items", "results", "sections", "songs", "videos"]) {
    if (obj[key]) harvest(obj[key], out, seen, limit);
  }
}

export async function searchMusic(query: string, limit = 20): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const client = await yt();
  const out: Track[] = [];
  const seen = new Set<string>();
  try {
    const res: any = await client.music.search(q, { type: "song" });
    harvest(res?.contents ?? res, out, seen, limit);
  } catch {
    /* ignore, fall through to video search */
  }
  if (out.length < limit) {
    try {
      const res: any = await client.music.search(q, { type: "video" });
      harvest(res?.contents ?? res, out, seen, limit);
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, limit);
}

// A thumbnail that exists for every public video, no API needed.
function fallbackThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// YouTube oEmbed: a public, lightweight endpoint that reliably returns
// title/author/thumbnail from any IP (unlike InnerTube's getBasicInfo, which is
// sparse for some videos and rate-limited on datacenter IPs like Vercel).
async function oEmbed(
  videoId: string,
): Promise<{ title: string; author: string; cover: string | null } | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d: any = await res.json();
    if (!d?.title) return null;
    return { title: d.title, author: d.author_name ?? "", cover: d.thumbnail_url ?? null };
  } catch {
    return null;
  }
}

// InnerTube basic info — mainly for duration (oEmbed doesn't provide it).
async function basicInfo(
  videoId: string,
): Promise<{ title: string | null; author: string; cover: string | null; durationSec: number | null } | null> {
  try {
    const client = await yt();
    const info: any = await client.getBasicInfo(videoId);
    const b = info?.basic_info ?? {};
    return {
      title: typeof b?.title === "string" && b.title ? b.title : null,
      author: b?.author ?? "",
      cover: pickThumb(b?.thumbnail),
      durationSec: typeof b?.duration === "number" ? b.duration : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a single video id to a Track (URL-paste path, #4).
 * oEmbed is the primary source (robust everywhere); InnerTube adds duration and
 * acts as a title fallback. A thumbnail is always present via fallbackThumb.
 */
export async function resolveVideo(videoId: string): Promise<Track | null> {
  const [o, b] = await Promise.all([oEmbed(videoId), basicInfo(videoId)]);
  const title = o?.title ?? b?.title ?? null;
  if (!title) return null; // genuinely couldn't identify the video
  return {
    videoId,
    title,
    artist: o?.author || b?.author || "",
    cover: b?.cover || o?.cover || fallbackThumb(videoId),
    durationSec: b?.durationSec ?? null,
  };
}

/** Radio / autoplay filler for the empty queue (#10). Related tracks for a seed. */
export async function radioFrom(videoId: string, limit = 10): Promise<Track[]> {
  const client = await yt();
  const out: Track[] = [];
  const seen = new Set<string>([videoId]);
  try {
    const up: any = await client.music.getUpNext(videoId);
    harvest(up, out, seen, limit);
  } catch {
    /* ignore */
  }
  if (out.length === 0) {
    try {
      const rel: any = await client.music.getRelated(videoId);
      harvest(rel, out, seen, limit);
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, limit);
}
