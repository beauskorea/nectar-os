import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";

const DB_PATH = "/root/projects/nectar-os/data/notes.db";

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

function plainToHtml(plain: string): string {
  const esc = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  if (lines.length === 0) return "";
  const [first, ...rest] = lines;
  const body = rest.map((l) => `<div>${l || "<br>"}</div>`).join("");
  return `<div><h1>${first}</h1></div>${body}`;
}

export async function POST(req: NextRequest) {
  let body: { plain?: string; board?: string; team?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const plain = typeof body.plain === "string" ? body.plain : "";
  const html = plainToHtml(plain);
  const firstLine = plain.split("\n")[0] || "새 메모";
  const title = firstLine.slice(0, 500);
  const board = body.board === "company" || body.board === "personal" ? body.board : "";
  const team = typeof body.team === "string" ? body.team : "";
  const id = `local-${randomUUID()}`;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const isoNow = new Date().toISOString().slice(0, 19) + "Z";

  try {
    await sqliteRun(
      [
        `BEGIN;`,
        `INSERT INTO notes (id, title, body, plain, folder, account, created_at, modified_at, deleted, pinned, board, team, synced_at) VALUES (${sqlQuote(id)}, ${sqlQuote(title)}, ${sqlQuote(html)}, ${sqlQuote(plain)}, '', '', '${isoNow}', '${isoNow}', 0, 0, ${sqlQuote(board)}, ${sqlQuote(team)}, '${now}');`,
        `INSERT INTO push_queue (note_id, body, plain, title, action, queued_at) VALUES (${sqlQuote(id)}, ${sqlQuote(html)}, ${sqlQuote(plain)}, ${sqlQuote(title)}, 'create', '${now}');`,
        `COMMIT;`,
      ].join("\n"),
    );
    return NextResponse.json({ ok: true, id, title, plain, board, team });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
