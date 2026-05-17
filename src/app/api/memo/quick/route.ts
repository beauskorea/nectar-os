import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/notes.db";

function sqlite(sql: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = stdin ? ["-bail", DB_PATH] : ["-bail", "-json", DB_PATH, sql];
    const child = spawn("sqlite3", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `sqlite exit ${code}`));
    });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

export async function GET() {
  try {
    const text = await sqlite(`SELECT body, updated_at FROM quick_memo WHERE k = 'main' LIMIT 1;`);
    const arr = text.trim() ? (JSON.parse(text) as { body: string; updated_at: string }[]) : [];
    const row = arr[0] || { body: "", updated_at: "" };
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body : "";
  try {
    const sql = `INSERT INTO quick_memo (k, body, updated_at) VALUES ('main', ${sqlQuote(text)}, datetime('now')) ON CONFLICT(k) DO UPDATE SET body = excluded.body, updated_at = datetime('now');`;
    await sqlite("", sql);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
