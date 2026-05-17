import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";

const LIST_PY = `import sqlite3, json, sys
db = sys.argv[1]
limit = int(sys.argv[2])
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT id, sent_at, to_email, to_name, subject, tone, result, materials FROM outreach_log ORDER BY sent_at DESC LIMIT ?", (limit,)).fetchall()
out = []
for r in rows:
    d = dict(r)
    try:
        d['materials'] = json.loads(d.get('materials') or '[]')
    except Exception:
        d['materials'] = []
    out.append(d)
sys.stdout.write(json.dumps(out, ensure_ascii=False))
`;

function runPython(args: string[], timeoutMs = 10000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => { clearTimeout(t); resolve({ ok: code === 0, out, err }); });
  });
}

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10) || 20, 100);
  const r = await runPython(["-c", LIST_PY, DB_PATH, String(limit)]);
  if (!r.ok) return NextResponse.json({ error: r.err }, { status: 500 });
  return NextResponse.json({ items: JSON.parse(r.out || "[]") });
}
