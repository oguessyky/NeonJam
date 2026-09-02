import { NextRequest, NextResponse } from "next/server";
import { extractVideoId, resolveVideo } from "@/lib/innertube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// URL-paste path (#4): resolve a pasted YouTube URL / id into a Track.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? req.nextUrl.searchParams.get("id") ?? "";
  const videoId = extractVideoId(raw);
  if (!videoId) return NextResponse.json({ error: "bad_url" }, { status: 400 });
  try {
    const track = await resolveVideo(videoId);
    if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ track });
  } catch {
    return NextResponse.json({ error: "resolve_failed" }, { status: 502 });
  }
}
