import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SCRIPT = "/root/projects/nectar-os/scripts/mail_summarize.py";

function runScript(args: string[], timeoutMs = 60000) {
  return new Promise<{ ok: boolean; out: string; err: string; code: number | null }>((resolve) => {
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
  let body: { messageId?: string; force?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  const args = [body.messageId];
  if (body.force) args.push("--force");

  const r = await runScript(args);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(r.out || "{}"); } catch {
    return NextResponse.json({
      error: r.err || "parse error",
      stdout: r.out.slice(-300),
      stderr: r.err.slice(-300),
    }, { status: 500 });
  }
  if (!r.ok || !parsed.ok) {
    return NextResponse.json({
      error: (parsed.error as string) || `exit ${r.code}`,
    }, { status: 502 });
  }
  return NextResponse.json(parsed);
}
