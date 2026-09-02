import { NextRequest, NextResponse } from "next/server";
import { radioFrom } from "@/lib/innertube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Empty-queue autoplay radio (#10): related tracks for a seed video.
export async function GET(req: NextRequest) {
  const seed = req.nextUrl.searchParams.get("seed") ?? "";
  if (!seed) return NextResponse.json({ results: [] });
  try {
    const results = await radioFrom(seed, 10);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
