import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/supabase-pg";

export const dynamic = "force-dynamic";

type Kind = "tweet" | "article" | "youtube" | "video" | "book" | "misc";
const KINDS: Kind[] = ["tweet", "article", "youtube", "video", "book", "misc"];

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function detectKind(text: string): { kind: Kind; url?: string } {
  const m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return { kind: "misc" };
  const url = m[0];
  if (/x\.com|twitter\.com/.test(url)) return { kind: "tweet", url };
  if (/youtube\.com|youtu\.be/.test(url)) return { kind: "youtube", url };
  return { kind: "article", url };
}

type Row = {
  id: string;
  ts: string;
  text: string;
  kind: Kind;
  url: string | null;
  source: string;
  consumed: boolean;
};

function shape(r: Row) {
  return {
    id: r.id,
    ts: new Date(r.ts).getTime(),
    text: r.text,
    kind: r.kind,
    url: r.url || undefined,
    source: r.source,
    consumed: r.consumed,
  };
}

export async function GET(req: NextRequest) {
  const includeConsumed = req.nextUrl.searchParams.get("include_consumed") === "1";
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    includeConsumed
      ? `SELECT id, ts, text, kind, url, source, consumed FROM ops.jinho_queue ORDER BY ts DESC LIMIT 1000`
      : `SELECT id, ts, text, kind, url, source, consumed FROM ops.jinho_queue WHERE consumed = false ORDER BY ts DESC LIMIT 1000`
  );
  return NextResponse.json({ items: rows.map(shape) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; ts?: number; text?: string; kind?: Kind; url?: string; source?: string }
    | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

  const detected = detectKind(text);
  const id = body?.id?.trim() || newId("q");
  const ts = body?.ts ? new Date(body.ts) : new Date();
  const kind: Kind = KINDS.includes(body?.kind as Kind) ? (body!.kind as Kind) : detected.kind;
  const url = (body?.url ?? detected.url) || null;
  const source = (body?.source || "web").slice(0, 32);

  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `INSERT INTO ops.jinho_queue (id, ts, text, kind, url, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       text = EXCLUDED.text,
       kind = EXCLUDED.kind,
       url = EXCLUDED.url,
       source = EXCLUDED.source
     RETURNING id, ts, text, kind, url, source, consumed`,
    [id, ts.toISOString(), text, kind, url, source]
  );
  return NextResponse.json({ item: shape(rows[0]) });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; text?: string; kind?: Kind; url?: string; consumed?: boolean }
    | null;
  const id = body?.id?.trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (typeof body?.text === "string" && body.text.trim()) {
    sets.push(`text = $${i++}`);
    vals.push(body.text.trim());
  }
  if (body?.kind && KINDS.includes(body.kind)) {
    sets.push(`kind = $${i++}`);
    vals.push(body.kind);
  }
  if (typeof body?.url === "string") {
    sets.push(`url = $${i++}`);
    vals.push(body.url || null);
  }
  if (typeof body?.consumed === "boolean") {
    sets.push(`consumed = $${i++}`);
    vals.push(body.consumed);
  }
  if (!sets.length) return NextResponse.json({ error: "no_fields" }, { status: 400 });
  vals.push(id);
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `UPDATE ops.jinho_queue SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, ts, text, kind, url, source, consumed`,
    vals
  );
  if (!rows.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item: shape(rows[0]) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM ops.jinho_queue WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true, deleted: rowCount });
}
