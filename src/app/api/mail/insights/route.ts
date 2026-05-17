import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCRIPT = "/root/projects/nectar-os/scripts/export_mail_insights.py";

function runScript(timeoutMs = 20000): Promise<{ ok: boolean; out: string; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let killed = false;
    const t = setTimeout(() => { killed = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0 && !killed, out, err, code });
    });
  });
}

export async function GET() {
  const r = await runScript();
  if (!r.ok) {
    return NextResponse.json({ error: `script exit ${r.code}`, stderr: r.err.slice(-500) }, { status: 500 });
  }
  try {
    const data = JSON.parse(r.out);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: "invalid script output", preview: r.out.slice(0, 200) }, { status: 500 });
  }
}
