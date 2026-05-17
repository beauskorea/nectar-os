import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/notes.db";

function sqlite(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-bail", "-json", DB_PATH, sql]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `sqlite exit ${code}`))));
  });
}

function sqliteRun(stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-bail", DB_PATH]);
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || `sqlite exit ${code}`))));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const expected = process.env.MEMO_SYNC_TOKEN || "";
  return !!expected && token === expected;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const text = await sqlite(`SELECT note_id, body, plain, COALESCE(action,'update') AS action, COALESCE(title,'') AS title, queued_at FROM push_queue ORDER BY queued_at ASC;`);
    const items = text.trim() ? JSON.parse(text) : [];
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string" && s) : [];
  if (!ids.length) return NextResponse.json({ ok: true, deleted: 0 });
  try {
    const inList = ids.map((s) => sqlQuote(s)).join(",");
    const localList = ids.filter((s) => s.startsWith("local-")).map((s) => sqlQuote(s)).join(",");
    const stmt = [`BEGIN;`, `DELETE FROM push_queue WHERE note_id IN (${inList});`];
    if (localList) stmt.push(`DELETE FROM notes WHERE id IN (${localList});`);
    stmt.push(`COMMIT;`);
    await sqliteRun(stmt.join("\n"));
    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
