import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const SCRIPT = "/root/projects/nectar-os/scripts/outreach_send.py";
const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";

const LOG_PY = `import sqlite3, sys, json
db = sys.argv[1]
p = json.loads(sys.stdin.read())
conn = sqlite3.connect(db, timeout=30)
conn.execute("""INSERT INTO outreach_log(sent_at, to_email, to_name, subject, body, materials, tone, result)
VALUES (strftime('%s','now'), ?, ?, ?, ?, ?, ?, ?)""",
(p['to'], p.get('name',''), p['subject'], p['body'],
 json.dumps(p.get('attachments') or [], ensure_ascii=False),
 p.get('tone') or 'default', 'ok'))
conn.commit()
sys.stdout.write('OK')
`;

function logOutreach(payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", LOG_PY, DB_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    const t = setTimeout(() => { child.kill("SIGTERM"); resolve(); }, 8000);
    child.on("close", () => { clearTimeout(t); resolve(); });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function runScript(payload: unknown, timeoutMs = 60000) {
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
  let body: {
    to?: string;
    name?: string;
    subject?: string;
    bodyText?: string;
    attachments?: string[];
    tone?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.to || !body.subject || !body.bodyText) {
    return NextResponse.json({ error: "to, subject, bodyText required" }, { status: 400 });
  }

  const payload = {
    to: body.to,
    name: body.name || "",
    subject: body.subject,
    body: body.bodyText,
    attachments: body.attachments || [],
  };

  const r = await runScript(payload);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(r.out || "{}"); } catch {
    return NextResponse.json({
      error: r.err || "script parse error",
      stdout: r.out.slice(-300),
      stderr: r.err.slice(-300),
    }, { status: 500 });
  }
  if (!r.ok || !parsed.ok) {
    return NextResponse.json({
      error: (parsed.error as string) || `exit ${r.code}`,
      detail: r.err.slice(-300),
    }, { status: 502 });
  }

  // log on success (fire-and-forget but await briefly)
  await logOutreach({ ...payload, tone: body.tone || "default" });

  return NextResponse.json(parsed);
}
