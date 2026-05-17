import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/supabase-pg";

export const dynamic = "force-dynamic";

type Category = "action" | "idea" | "reference" | "snooze";
type Priority = "P0" | "P1" | "P2" | "P3";

const CATEGORIES: Category[] = ["action", "idea", "reference", "snooze"];
const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

type Row = {
  id: string;
  ts: string;
  text: string;
  category: Category;
  priority: Priority;
  source: string;
  archived: boolean;
};

function shape(r: Row) {
  return {
    id: r.id,
    ts: new Date(r.ts).getTime(),
    text: r.text,
    category: r.category,
    priority: r.priority,
    source: r.source,
    archived: r.archived,
  };
}

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get("include_archived") === "1";
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    includeArchived
      ? `SELECT id, ts, text, category, priority, source, archived FROM ops.jinho_inbox ORDER BY ts DESC LIMIT 1000`
      : `SELECT id, ts, text, category, priority, source, archived FROM ops.jinho_inbox WHERE archived = false ORDER BY ts DESC LIMIT 1000`
  );
  return NextResponse.json({ items: rows.map(shape) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        id?: string;
        ts?: number;
        text?: string;
        category?: Category;
        priority?: Priority;
        source?: string;
      }
    | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

  const id = body?.id?.trim() || newId("i");
  const ts = body?.ts ? new Date(body.ts) : new Date();
  const category: Category = CATEGORIES.includes(body?.category as Category)
    ? (body!.category as Category)
    : "action";
  const priority: Priority = PRIORITIES.includes(body?.priority as Priority)
    ? (body!.priority as Priority)
    : "P2";
  const source = (body?.source || "web").slice(0, 32);

  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `INSERT INTO ops.jinho_inbox (id, ts, text, category, priority, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       text = EXCLUDED.text,
       category = EXCLUDED.category,
       priority = EXCLUDED.priority,
       source = EXCLUDED.source
     RETURNING id, ts, text, category, priority, source, archived`,
    [id, ts.toISOString(), text, category, priority, source]
  );
  return NextResponse.json({ item: shape(rows[0]) });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        id?: string;
        text?: string;
        category?: Category;
        priority?: Priority;
        archived?: boolean;
      }
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
  if (body?.category && CATEGORIES.includes(body.category)) {
    sets.push(`category = $${i++}`);
    vals.push(body.category);
  }
  if (body?.priority && PRIORITIES.includes(body.priority)) {
    sets.push(`priority = $${i++}`);
    vals.push(body.priority);
  }
  if (typeof body?.archived === "boolean") {
    sets.push(`archived = $${i++}`);
    vals.push(body.archived);
  }
  if (!sets.length) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  vals.push(id);
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `UPDATE ops.jinho_inbox SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, ts, text, category, priority, source, archived`,
    vals
  );
  if (!rows.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item: shape(rows[0]) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM ops.jinho_inbox WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true, deleted: rowCount });
}
