import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENTS_PATH =
  process.env.EVENTS_JSON_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), "public", "events.json");
const MINE_CALENDARS = new Set(["beauskorea", "personal", "private", "primary", "jinho"]);
const TEAM_EXCLUDED_CALENDARS = new Set(["holiday", "quick", ...MINE_CALENDARS]);

type CalendarEvent = {
  cal?: string;
  [key: string]: unknown;
};

let cache: { mtime: number; raw: Buffer; gz: Buffer } | null = null;

async function load(): Promise<{ raw: Buffer; gz: Buffer }> {
  const stat = await fs.stat(EVENTS_PATH);
  const mtime = stat.mtimeMs;
  if (cache && cache.mtime === mtime) return { raw: cache.raw, gz: cache.gz };
  const raw = await fs.readFile(EVENTS_PATH);
  const gz = zlib.gzipSync(raw, { level: 6 });
  cache = { mtime, raw, gz };
  return { raw, gz };
}

export async function GET(req: NextRequest) {
  let data: { raw: Buffer; gz: Buffer };
  try {
    data = await load();
  } catch (e) {
    return NextResponse.json(
      { error: "events_load_failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
  const scope = req.nextUrl.searchParams.get("scope");
  if (scope === "mine" || scope === "team") {
    let json: { events?: CalendarEvent[]; [key: string]: unknown };
    try {
      json = JSON.parse(data.raw.toString("utf8"));
    } catch (e) {
      return NextResponse.json(
        { error: "events_parse_failed", detail: (e as Error).message },
        { status: 500 },
      );
    }
    const source = Array.isArray(json.events) ? json.events : [];
    const events = source.filter((event) => {
      const cal = String(event.cal || "");
      if (scope === "mine") return MINE_CALENDARS.has(cal) || cal === "holiday";
      return cal !== "" && !TEAM_EXCLUDED_CALENDARS.has(cal);
    });
    return NextResponse.json(
      { ...json, scope, count: events.length, events },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  }
  const accept = req.headers.get("accept-encoding") || "";
  const wantsGzip = /\bgzip\b/.test(accept);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    vary: "accept-encoding",
  };
  if (wantsGzip) {
    headers["content-encoding"] = "gzip";
    return new NextResponse(new Uint8Array(data.gz), { status: 200, headers });
  }
  return new NextResponse(new Uint8Array(data.raw), { status: 200, headers });
}
