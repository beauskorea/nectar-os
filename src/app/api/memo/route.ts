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

function rows<T = Record<string, unknown>>(text: string): T[] {
  const t = text.trim();
  if (!t) return [];
  try {
    return JSON.parse(t) as T[];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const folder = (url.searchParams.get("folder") || "").trim();
  const team = (url.searchParams.get("team") || "").trim();
  const board = (url.searchParams.get("board") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  try {
    let listSql = `SELECT id, title, substr(plain, 1, 160) AS preview, folder, account, modified_at, created_at, pinned, COALESCE(board,'') AS board, COALESCE(team,'') AS team
                   FROM notes WHERE deleted = 0`;
    if (q) {
      const like = sqlQuote("%" + q.replace(/[%_]/g, " ") + "%");
      listSql += ` AND (title LIKE ${like} OR plain LIKE ${like})`;
    }
    if (folder) {
      listSql += ` AND folder = ${sqlQuote(folder)}`;
    }
    if (board) {
      listSql += ` AND board = ${sqlQuote(board)}`;
    }
    if (team) {
      listSql += ` AND team = ${sqlQuote(team)}`;
    }
    listSql += ` ORDER BY pinned DESC, modified_at DESC LIMIT ${limit} OFFSET ${offset};`;

    const [list, totalRaw, foldersRaw, stateRaw] = await Promise.all([
      sqlite(listSql),
      sqlite(`SELECT COUNT(*) AS c FROM notes WHERE deleted = 0;`),
      sqlite(`SELECT folder, COUNT(*) AS c FROM notes WHERE deleted = 0 GROUP BY folder ORDER BY c DESC;`),
      sqlite(`SELECT v FROM sync_state WHERE k = 'last_sync_at';`),
    ]);

    return NextResponse.json({
      notes: rows(list),
      total: (rows<{ c: number }>(totalRaw)[0]?.c) || 0,
      folders: rows<{ folder: string; c: number }>(foldersRaw),
      last_sync_at: (rows<{ v: string }>(stateRaw)[0]?.v) || null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function jsonEscape(s: string) {
  return s.replace(/'/g, "''");
}

type IncomingNote = {
  id: string;
  title?: string;
  body?: string;
  plain?: string;
  folder?: string;
  account?: string;
  created_at?: string;
  modified_at?: string;
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const expected = process.env.MEMO_SYNC_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { notes?: IncomingNote[]; full_id_list?: string[]; full?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const incoming = Array.isArray(body.notes) ? body.notes : [];
  if (!incoming.length && !body.full) {
    return NextResponse.json({ error: "empty_batch" }, { status: 400 });
  }

  try {
    const lines: string[] = ["BEGIN;"];
    for (const n of incoming) {
      if (!n.id) continue;
      const id = jsonEscape(n.id);
      const title = jsonEscape((n.title || "").slice(0, 500));
      const bodyText = jsonEscape(n.body || "");
      const plain = jsonEscape(n.plain || "");
      const folder = jsonEscape(n.folder || "");
      const account = jsonEscape(n.account || "");
      const created = jsonEscape(n.created_at || "");
      const modified = jsonEscape(n.modified_at || "");
      lines.push(
        `INSERT INTO notes (id, title, body, plain, folder, account, created_at, modified_at, deleted, synced_at) ` +
          `VALUES ('${id}', '${title}', '${bodyText}', '${plain}', '${folder}', '${account}', '${created}', '${modified}', 0, datetime('now')) ` +
          `ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, plain=excluded.plain, folder=excluded.folder, ` +
          `account=excluded.account, created_at=excluded.created_at, modified_at=excluded.modified_at, deleted=0, synced_at=datetime('now');`,
      );
      lines.push(`DELETE FROM notes_fts WHERE id = '${id}';`);
      lines.push(`INSERT INTO notes_fts (id, title, plain) VALUES ('${id}', '${title}', '${plain}');`);
    }

    if (body.full && Array.isArray(body.full_id_list)) {
      const valid = body.full_id_list.filter((s) => typeof s === "string" && s.length > 0);
      if (valid.length) {
        const inList = valid.map((s) => `'${jsonEscape(s)}'`).join(",");
        lines.push(
          `UPDATE notes SET deleted = 1, synced_at = datetime('now') WHERE deleted = 0 AND id NOT IN (${inList});`,
        );
      }
    }

    lines.push(
      `INSERT INTO sync_state (k, v) VALUES ('last_sync_at', datetime('now')) ON CONFLICT(k) DO UPDATE SET v = excluded.v;`,
    );
    lines.push("COMMIT;");

    const script = lines.join("\n");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("sqlite3", [DB_PATH]);
      let err = "";
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(err || `sqlite exit ${code}`));
      });
      child.stdin.write(script);
      child.stdin.end();
    });

    return NextResponse.json({ ok: true, upserted: incoming.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
