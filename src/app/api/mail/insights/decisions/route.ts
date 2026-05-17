import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/ceo_mail.db";
const VALID_DECISIONS = new Set(["done", "skip", "ignore"]);

function runPython(code: string, args: string[] = [], timeoutMs = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", code, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out, err });
    });
  });
}

const LIST_PY = `import sqlite3, json, sys
db, date = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db, timeout=30)
conn.row_factory = sqlite3.Row
if date == 'ALL':
    rows = conn.execute("SELECT * FROM action_decisions WHERE decided_at >= strftime('%s','now','-30 days') ORDER BY decided_at DESC").fetchall()
else:
    rows = conn.execute("SELECT * FROM action_decisions WHERE date=? ORDER BY decided_at DESC", (date,)).fetchall()
sys.stdout.write(json.dumps([dict(r) for r in rows], ensure_ascii=False))
`;

const UPSERT_PY = `import sqlite3, sys
db, date, line_hash, decision, line_text, note = sys.argv[1:7]
conn = sqlite3.connect(db, timeout=30)
conn.execute("""
INSERT INTO action_decisions(date, line_hash, decision, line_text, note, decided_at)
VALUES (?,?,?,?,?,strftime('%s','now'))
ON CONFLICT(date, line_hash) DO UPDATE SET
  decision=excluded.decision,
  line_text=excluded.line_text,
  note=excluded.note,
  decided_at=excluded.decided_at
""", (date, line_hash, decision, line_text, note or None))
conn.commit()
sys.stdout.write('OK')
`;

const DELETE_PY = `import sqlite3, sys
db, date, line_hash = sys.argv[1:4]
conn = sqlite3.connect(db, timeout=30)
conn.execute("DELETE FROM action_decisions WHERE date=? AND line_hash=?", (date, line_hash))
conn.commit()
sys.stdout.write('OK')
`;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || "ALL";
  const r = await runPython(LIST_PY, [DB_PATH, date]);
  if (!r.ok) return NextResponse.json({ error: r.err }, { status: 500 });
  return NextResponse.json({ decisions: JSON.parse(r.out || "[]") });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    line_hash?: string;
    decision?: string;
    line_text?: string;
    note?: string;
  };
  const { date, line_hash, decision, line_text, note } = body;
  if (!date || !line_hash || !decision) {
    return NextResponse.json({ error: "date, line_hash, decision required" }, { status: 400 });
  }
  if (!VALID_DECISIONS.has(decision)) {
    return NextResponse.json({ error: `decision must be one of ${[...VALID_DECISIONS].join(",")}` }, { status: 400 });
  }
  const r = await runPython(UPSERT_PY, [DB_PATH, date, line_hash, decision, line_text || "", note || ""]);
  if (!r.ok) return NextResponse.json({ error: r.err }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { date?: string; line_hash?: string };
  if (!body.date || !body.line_hash) return NextResponse.json({ error: "date, line_hash required" }, { status: 400 });
  const r = await runPython(DELETE_PY, [DB_PATH, body.date, body.line_hash]);
  if (!r.ok) return NextResponse.json({ error: r.err }, { status: 500 });
  return NextResponse.json({ ok: true });
}
