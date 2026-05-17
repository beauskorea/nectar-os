import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const STORE = path.join(process.cwd(), "data", "decisions.json");

type Decision = {
  id: string;
  ts: number;
  date: string;
  question: string;
  text: string;
  drafts?: string[];
  todos?: string[];
  source: "chat" | "manual";
};

async function load(): Promise<Decision[]> {
  try {
    const raw = await fs.readFile(STORE, "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j?.items) ? j.items : [];
  } catch {
    return [];
  }
}

async function save(items: Decision[]) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify({ items: items.slice(-500) }, null, 2), "utf-8");
}

export async function GET() {
  const items = await load();
  items.sort((a, b) => b.ts - a.ts);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const entry: Decision = {
    id: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    date:
      body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    question: typeof body.question === "string" ? body.question : "",
    text: String(body.text).slice(0, 800),
    drafts: Array.isArray(body.drafts) ? body.drafts.slice(0, 5) : undefined,
    todos: Array.isArray(body.todos) ? body.todos.slice(0, 10) : undefined,
    source: body.source === "manual" ? "manual" : "chat",
  };
  const items = await load();
  items.push(entry);
  await save(items);
  return NextResponse.json({ ok: true, decision: entry });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const items = await load();
  const next = items.filter((it) => it.id !== id);
  await save(next);
  return NextResponse.json({ ok: true, removed: items.length - next.length });
}
