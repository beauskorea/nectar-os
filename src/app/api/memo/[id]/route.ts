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
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `sqlite exit ${code}`));
    });
  });
}

function sqlQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    const text = await sqlite(
      `SELECT id, title, body, plain, folder, account, created_at, modified_at, pinned, COALESCE(board,'') AS board, COALESCE(team,'') AS team FROM notes WHERE id = ${sqlQuote(id)} AND deleted = 0 LIMIT 1;`,
    );
    const arr = text.trim() ? (JSON.parse(text) as Record<string, unknown>[]) : [];
    if (!arr.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ note: arr[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function plainToHtml(plain: string): string {
  const esc = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  if (lines.length === 0) return "";
  const [first, ...rest] = lines;
  const body = rest.map((l) => `<div>${l || "<br>"}</div>`).join("");
  return `<div><h1>${first}</h1></div>${body}`;
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

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  let body: { plain?: string; pinned?: boolean; board?: string; team?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    const metaParts: string[] = [];
    if (typeof body.pinned === "boolean") metaParts.push(`pinned = ${body.pinned ? 1 : 0}`);
    if (typeof body.board === "string") metaParts.push(`board = ${sqlQuote(body.board)}`);
    if (typeof body.team === "string") metaParts.push(`team = ${sqlQuote(body.team)}`);
    if (metaParts.length && body.plain === undefined) {
      await sqliteRun(`UPDATE notes SET ${metaParts.join(", ")} WHERE id = ${sqlQuote(id)};`);
      return NextResponse.json({ ok: true });
    }

    const plain = typeof body.plain === "string" ? body.plain : "";
    const html = plainToHtml(plain);
    const firstLine = plain.split("\n")[0] || "";
    const title = firstLine.slice(0, 500);
    const isLocal = id.startsWith("local-");
    const action = isLocal ? "create" : "update";
    const stmt = [
      `BEGIN;`,
      `UPDATE notes SET title = ${sqlQuote(title)}, body = ${sqlQuote(html)}, plain = ${sqlQuote(plain)}, modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), synced_at = datetime('now') WHERE id = ${sqlQuote(id)};`,
      `INSERT INTO push_queue (note_id, body, plain, title, action, queued_at) VALUES (${sqlQuote(id)}, ${sqlQuote(html)}, ${sqlQuote(plain)}, ${sqlQuote(title)}, ${sqlQuote(action)}, datetime('now')) ON CONFLICT(note_id) DO UPDATE SET body = excluded.body, plain = excluded.plain, title = excluded.title, queued_at = excluded.queued_at;`,
      `COMMIT;`,
    ].join("\n");
    await sqliteRun(stmt);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  try {
    const isLocal = id.startsWith("local-");
    if (isLocal) {
      await sqliteRun(
        `BEGIN;
         DELETE FROM notes WHERE id = ${sqlQuote(id)};
         DELETE FROM push_queue WHERE note_id = ${sqlQuote(id)};
         COMMIT;`,
      );
    } else {
      await sqliteRun(
        `BEGIN;
         UPDATE notes SET deleted = 1, modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ${sqlQuote(id)};
         INSERT INTO push_queue (note_id, body, plain, title, action, queued_at) VALUES (${sqlQuote(id)}, '', '', '', 'delete', datetime('now')) ON CONFLICT(note_id) DO UPDATE SET action = 'delete', queued_at = datetime('now');
         COMMIT;`,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
