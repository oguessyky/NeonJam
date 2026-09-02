import { NextRequest, NextResponse } from "next/server";
import { searchMusic } from "@/lib/innertube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 200) ?? "";
  if (!q.trim()) return NextResponse.json({ results: [] });
  try {
    const results = await searchMusic(q, 20);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "search_unavailable" }, { status: 502 });
  }
}
