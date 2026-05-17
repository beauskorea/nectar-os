import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SCRIPT = "/root/projects/nectar-os/scripts/imap_triage.py";

function runScript(args: string[], timeoutMs = 30000): Promise<{ ok: boolean; out: string; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
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
  });
}

export async function POST(req: NextRequest) {
  let body: { messageId?: string; action?: "trash" | "spam" | "restore"; localOnly?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.messageId || !body.action) {
    return NextResponse.json({ error: "messageId + action required" }, { status: 400 });
  }

  const r = await runScript([body.messageId, body.action]);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(r.out || "{}");
  } catch {
    return NextResponse.json({
      error: r.err || "script parse error",
      stderr: r.err.slice(-500),
      stdout: r.out.slice(-500),
    }, { status: 500 });
  }
  if (!r.ok || !parsed.ok) {
    return NextResponse.json({
      error: (parsed.error as string) || `script exit ${r.code}`,
      detail: r.err.slice(-300),
    }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    action: body.action,
    note:
      body.action === "restore"
        ? "DB만 복구 (IMAP 위치는 그대로)"
        : `IMAP에서 "${parsed.moved_to}" 폴더로 이동 + DB 업데이트`,
    ...parsed,
  });
}
