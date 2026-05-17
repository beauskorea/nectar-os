import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SCRIPTS: Record<string, string> = {
  fetch: "/root/projects/nectar-os/scripts/fetch_ceo_mail.py",
  classify: "/root/projects/nectar-os/scripts/classify_priority.py",
  insight: "/root/projects/nectar-os/scripts/generate_news_insights.py",
};

async function runScript(path: string, timeoutMs = 120000): Promise<{ ok: boolean; out: string; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [path], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0 && !killed, out: out.slice(-2000), err: err.slice(-2000), code });
    });
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const action = body.action || "";
  const script = SCRIPTS[action];
  if (!script) return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });

  const t0 = Date.now();
  const r = await runScript(script);
  // summary: 마지막 줄 추출
  const lastLine = r.out.trim().split("\n").pop() || r.err.trim().split("\n").pop() || "";
  return NextResponse.json({
    ok: r.ok,
    action,
    code: r.code,
    elapsedMs: Date.now() - t0,
    summary: lastLine.slice(0, 200),
    stdout: r.out,
    stderr: r.err,
    error: r.ok ? undefined : `exit ${r.code}`,
  }, { status: r.ok ? 200 : 500 });
}
