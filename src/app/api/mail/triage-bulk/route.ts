import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SCRIPT = "/root/projects/nectar-os/scripts/imap_triage_bulk.py";

function runScript(payload: unknown, timeoutMs = 120000) {
  return new Promise<{ ok: boolean; out: string; err: string; code: number | null }>((resolve) => {
    const child = spawn("python3", [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let killed = false;
    const t = setTimeout(() => { killed = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0 && !killed, out: out.trim(), err: err.trim(), code });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  let body: { messageIds?: string[]; action?: "trash" | "spam" | "restore" };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.messageIds || !body.action || !Array.isArray(body.messageIds)) {
    return NextResponse.json({ error: "messageIds[] + action required" }, { status: 400 });
  }
  if (body.messageIds.length === 0) {
    return NextResponse.json({ ok: true, processed: [], failed: [] });
  }
  if (body.messageIds.length > 500) {
    return NextResponse.json({ error: "최대 500건" }, { status: 400 });
  }
  const r = await runScript(body);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(r.out || "{}"); } catch {
    return NextResponse.json({ error: r.err || "parse error" }, { status: 500 });
  }
  if (!r.ok || !parsed.ok) {
    return NextResponse.json({ error: (parsed.error as string) || `exit ${r.code}` }, { status: 502 });
  }
  return NextResponse.json(parsed);
}
